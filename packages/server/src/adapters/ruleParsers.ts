import { parseRuleText, RuleBodySchema, type Household, type RuleBody } from "@off-peak/core";
import type { Config } from "../config.ts";
import { logError } from "../log.ts";
import type { RuleParser } from "../ports.ts";

export class DeterministicRuleParser implements RuleParser {
  readonly kind: "deterministic" | "bedrock" = "deterministic";
  async parse(text: string, h: Household): Promise<RuleBody | null> {
    return parseRuleText(text, h);
  }
}

const RULE_PROMPT = `You convert a household energy rule into JSON. Reply with ONE JSON object and nothing else.
Allowed shapes (HH:mm is 24-hour):
{"type":"quiet_hours","start":"HH:mm","end":"HH:mm","appliesTo":"noisy"}
{"type":"deadline","deviceId":"<id>","by":"HH:mm","targetPercent":<1-100, optional>,"days":["mon",...] (optional)}
{"type":"comfort","zoneId":"<id, optional>","minF":<n>,"maxF":<n>,"when":"occupied"|"always"}
{"type":"never_off","deviceId":"<id>"}
{"type":"ask_first","deviceId":"<id>"}
{"type":"max_load","kw":<n>}
If the text is not one of these rules, reply {"type":"none"}.`;

/** Deterministic first; Bedrock (Converse) second, validated with Zod. */
export class BedrockRuleParser implements RuleParser {
  readonly kind = "bedrock" as const;
  readonly #config: Config;
  readonly #fallback = new DeterministicRuleParser();

  constructor(config: Config) {
    this.#config = config;
  }

  async parse(text: string, h: Household): Promise<RuleBody | null> {
    const quick = await this.#fallback.parse(text, h);
    if (quick || !this.#config.bedrockModelId) return quick;
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
      const client = new BedrockRuntimeClient({ region: this.#config.awsRegion });
      const devices = h.devices.map((d) => `${d.id} (${d.name})`).join(", ");
      const zones = h.zones.map((z) => `${z.id} (${z.name})`).join(", ");
      const res = await client.send(
        new ConverseCommand({
          modelId: this.#config.bedrockModelId,
          system: [{ text: `${RULE_PROMPT}\nDevices: ${devices}\nZones: ${zones}` }],
          messages: [{ role: "user", content: [{ text }] }],
          inferenceConfig: { maxTokens: 200, temperature: 0 },
        }),
      );
      const out = res.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
      const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
      const parsed = RuleBodySchema.safeParse(JSON.parse(json));
      if (!parsed.success) return null;
      const r = parsed.data;
      if ("deviceId" in r && !h.devices.some((d) => d.id === r.deviceId)) return null;
      return r;
    } catch (err) {
      logError("bedrock.parseRule", err);
      return null;
    }
  }
}
