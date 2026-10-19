export interface Config {
  port: number;
  webOrigin: string;
  householdTz: string;
  demoZip?: string;
  tariffSource: "demo" | "fixture" | "openei";
  openeiApiKey?: string;
  clock: "sim" | "real";
  simStart?: string;
  store: "memory" | "json" | "dynamodb";
  dataDir: string;
  scheduler: "local" | "eventbridge";
  devices: "sim" | "homeassistant";
  haUrl?: string;
  haToken?: string;
  llmMode: "mock" | "bedrock";
  ruleParser: "deterministic" | "bedrock";
  awsRegion: string;
  bedrockModelId?: string;
  ddbTable: string;
  executorLambdaArn?: string;
  schedulerRoleArn?: string;
  simAdmin: boolean;
  /** Hostnames accepted on /mcp (DNS-rebinding protection). Empty = no check. */
  allowedHosts: string[];
}

type Env = Record<string, string | undefined>;

/** Reads a variable, tolerating inline "# comments" copied from .env.example. */
function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.replace(/\s+#.*$/, "").trim();
  return value === "" ? undefined : value;
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const v = read(env, name);
  if (v === undefined) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`${name} must be one of ${allowed.join(" | ")} (got "${v}")`);
}

export function loadConfig(env: Env = process.env): Config {
  const onLambda = Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
  const llmMode = oneOf(env, "LLM_MODE", ["mock", "bedrock"], "mock");
  const hosts = read(env, "MCP_ALLOWED_HOSTS");
  return {
    port: Number(read(env, "PORT") ?? 8787),
    webOrigin: read(env, "WEB_ORIGIN") ?? "http://localhost:5173",
    householdTz: read(env, "HOUSEHOLD_TZ") ?? "America/Los_Angeles",
    demoZip: read(env, "DEMO_ZIP"),
    tariffSource: oneOf(env, "TARIFF_SOURCE", ["demo", "fixture", "openei"], "demo"),
    openeiApiKey: read(env, "OPENEI_API_KEY"),
    clock: oneOf(env, "CLOCK", ["sim", "real"], "sim"),
    simStart: read(env, "SIM_START"),
    store: oneOf(env, "STORE", ["memory", "json", "dynamodb"], onLambda ? "dynamodb" : "json"),
    dataDir: read(env, "DATA_DIR") ?? ".data",
    scheduler: oneOf(env, "SCHEDULER", ["local", "eventbridge"], "local"),
    devices: oneOf(env, "DEVICES", ["sim", "homeassistant"], "sim"),
    haUrl: read(env, "HA_URL"),
    haToken: read(env, "HA_TOKEN"),
    llmMode,
    ruleParser: oneOf(env, "RULE_PARSER", ["deterministic", "bedrock"], llmMode === "bedrock" ? "bedrock" : "deterministic"),
    awsRegion: read(env, "AWS_REGION") ?? "us-east-1",
    bedrockModelId: read(env, "BEDROCK_MODEL_ID"),
    ddbTable: read(env, "DDB_TABLE") ?? "OffPeak",
    executorLambdaArn: read(env, "EXECUTOR_LAMBDA_ARN"),
    schedulerRoleArn: read(env, "SCHEDULER_ROLE_ARN"),
    simAdmin: read(env, "SIM_ADMIN") === "1",
    allowedHosts: hosts ? hosts.split(",").map((h) => h.trim()) : onLambda ? [] : ["localhost", "127.0.0.1", "[::1]"],
  };
}
