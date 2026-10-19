import { App } from "aws-cdk-lib";
import { OffPeakStack } from "../lib/offpeak-stack.ts";

const app = new App();
new OffPeakStack(app, "OffPeak", {
  description: "Off-Peak: Alexa+ add-on MCP server (hackathon demo; run `cdk destroy` after testing)",
  env: process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION } : undefined,
});
