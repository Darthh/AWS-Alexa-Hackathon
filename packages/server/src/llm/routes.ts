import { DateTime } from "luxon";
import express, { type Response, Router } from "express";
import { log, logError } from "../log.ts";
import type { Runtime } from "../runtime.ts";
import { mockConverse, type ConverseMessage } from "./mock.ts";

/** SPEC §12 — used verbatim. */
export const SYSTEM_PROMPT =
  "You are Alexa+, speaking aloud in a home. Use the Off-Peak tools for anything about electricity cost, when to run appliances, leaving or arriving home, which rooms are in use, or saving money. Call plan_tasks before apply_plan, and ask the user to confirm unless they already said to go ahead. Reply in at most two short sentences, based on the tool's text. Never invent prices, times, or savings; only state numbers returned by tools. Use 12-hour times.";

/** Minimal client surface (BedrockRuntimeClient / PollyClient), injectable for tests. */
export interface AwsClient {
  send(command: unknown): Promise<any>;
}

export interface LlmDeps {
  bedrock?: AwsClient;
  polly?: AwsClient;
}

interface ToolSpec {
  toolSpec: { name: string; description?: string; inputSchema: { json: Record<string, unknown> } };
}

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message, speakable: message });
}

/** Household-local time for the model (the sim clock, not the wall clock). */
function clockContext(rt: Runtime): string {
  const local = DateTime.fromJSDate(rt.clock.now(), { zone: rt.timezone });
  return `It is ${local.toFormat("cccc, LLLL d, h:mm a")} in the home (${rt.timezone}). Pass times to tools as 24-hour HH:mm.`;
}

/**
 * LLM proxy for the web simulator (not part of MCP). The browser owns the loop and calls MCP itself;
 * this route only turns messages + tool specs into the next model message.
 */
export function llmRouter(rt: Runtime, deps: LlmDeps = {}): Router {
  const r = Router();
  r.use(express.json({ limit: "2mb" }));
  const { config } = rt;
  const pollyVoice = process.env.POLLY_VOICE;

  r.get("/config", (_req, res) => {
    res.json({
      mode: config.llmMode,
      modelId: config.bedrockModelId ?? null,
      region: config.awsRegion,
      tts: pollyVoice ? "polly" : "browser",
      systemPrompt: SYSTEM_PROMPT,
    });
  });

  r.post("/converse", async (req, res) => {
    const { messages, tools } = (req.body ?? {}) as { messages?: ConverseMessage[]; tools?: ToolSpec[] };
    if (!Array.isArray(messages) || messages.length === 0) return fail(res, 400, "messages are required");
    const started = performance.now();

    if (config.llmMode === "mock") {
      const out = mockConverse(messages);
      log({ llm: "mock", ms: Math.round(performance.now() - started), stopReason: out.stopReason });
      return res.json({ ...out, mode: "mock", latencyMs: Math.round(performance.now() - started) });
    }

    if (!config.bedrockModelId) {
      return fail(res, 503, "Bedrock mode needs BEDROCK_MODEL_ID. Run npm run bedrock:models to list the models in your region.");
    }
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
      deps.bedrock ??= new BedrockRuntimeClient({ region: config.awsRegion });
      const out = await deps.bedrock.send(
        new ConverseCommand({
          modelId: config.bedrockModelId,
          system: [{ text: SYSTEM_PROMPT }, { text: clockContext(rt) }],
          messages: messages as never,
          // No temperature/topP: current Claude models on Bedrock reject sampling parameters.
          inferenceConfig: { maxTokens: 1024 },
          ...(tools?.length ? { toolConfig: { tools: tools as never } } : {}),
        }),
      );
      const ms = Math.round(performance.now() - started);
      log({ llm: "bedrock", model: config.bedrockModelId, ms, stopReason: out.stopReason, usage: out.usage });
      res.json({ output: out.output, stopReason: out.stopReason, usage: out.usage, mode: "bedrock", latencyMs: ms });
    } catch (err) {
      logError("bedrock.converse", err);
      const name = (err as { name?: string }).name ?? "Error";
      const hint =
        name === "CredentialsProviderError" || name === "UnrecognizedClientException"
          ? "No AWS credentials were found for Bedrock."
          : name === "AccessDeniedException"
            ? "This AWS account doesn't have access to that Bedrock model."
            : name === "ValidationException"
              ? `Bedrock rejected the request: ${(err as Error).message}`
              : "Bedrock is unavailable right now.";
      fail(res, 502, `${hint} Switch to scripted mode to keep going.`);
    }
  });

  r.post("/tts", async (req, res) => {
    const { text } = (req.body ?? {}) as { text?: string };
    if (!pollyVoice) return fail(res, 404, "Polly is off (set POLLY_VOICE, e.g. Joanna).");
    if (!text) return fail(res, 400, "text is required");
    try {
      const { PollyClient, SynthesizeSpeechCommand } = await import("@aws-sdk/client-polly");
      deps.polly ??= new PollyClient({ region: config.awsRegion });
      const out = await deps.polly.send(
        new SynthesizeSpeechCommand({ Text: text.slice(0, 1500), VoiceId: pollyVoice as never, Engine: "neural", OutputFormat: "mp3" }),
      );
      const bytes: Uint8Array | undefined = await out.AudioStream?.transformToByteArray();
      if (!bytes) return fail(res, 502, "Polly returned no audio.");
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(Buffer.from(bytes));
    } catch (err) {
      logError("polly", err);
      fail(res, 502, "Polly is unavailable; using the browser voice.");
    }
  });

  return r;
}
