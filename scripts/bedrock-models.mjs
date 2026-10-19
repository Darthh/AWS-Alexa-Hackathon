#!/usr/bin/env node
// Lists Bedrock text models in AWS_REGION that are ACTIVE and usable with the Converse API,
// plus the region's inference profiles, so the team can pick BEDROCK_MODEL_ID. Needs the AWS CLI + credentials.
import { execFileSync } from "node:child_process";

const region = process.env.AWS_REGION ?? "us-east-1";
const aws = (...args) => JSON.parse(execFileSync("aws", [...args, "--region", region, "--output", "json"], { encoding: "utf8" }));

try {
  const { modelSummaries } = aws("bedrock", "list-foundation-models", "--by-output-modality", "TEXT");
  const usable = modelSummaries.filter((m) => m.modelLifecycle?.status === "ACTIVE" && m.inferenceTypesSupported?.length);
  console.log(`Text models in ${region} (ACTIVE):`);
  for (const m of usable) console.log(`  ${m.modelId.padEnd(52)} ${m.providerName} ${m.modelName} [${m.inferenceTypesSupported.join(", ")}]`);
  const { inferenceProfileSummaries } = aws("bedrock", "list-inference-profiles");
  console.log(`\nInference profiles (use these IDs for models that require one):`);
  for (const p of inferenceProfileSummaries) console.log(`  ${p.inferenceProfileId.padEnd(52)} ${p.inferenceProfileName}`);
  console.log("\nPick a model that supports tool use in the Converse API, set BEDROCK_MODEL_ID, and record it in DECISIONS.md.");
} catch (err) {
  console.error(`Couldn't list Bedrock models in ${region}: ${err.message.split("\n")[0]}`);
  console.error("Configure AWS credentials (aws configure / AWS_PROFILE) and try again.");
  process.exit(1);
}
