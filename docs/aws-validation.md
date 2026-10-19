# AWS validation runbook

Prepared October 19, 2026. This pass stays free: the public demo uses Cloudflare, mock conversation and simulated devices. AWS integrations have local build/test evidence; no live AWS validation is claimed. The account discovery and live-test steps below are instructions for a future session, not steps executed for this pass.

## 1. Reproduce the checks without AWS

Use Node.js 22.18 or newer and PowerShell from the repository root. Dependency installation downloads packages; these checks do not require AWS credentials. Stop if any command fails.

```powershell
npm ci
npm run lint
npm test
npm run build:lambda
```

The Bedrock tests inject a fake client. They verify request shape, tool results and error handling without invoking a model. The Lambda build creates `packages/server/dist-lambda/`; a successful package is not a deployed Lambda.

To synthesize the current CDK app without the CLI's account discovery, run the app directly with its checked-in context. This writes an ignored local cloud assembly and does not resolve account credentials or create resources:

```powershell
Push-Location infra
npm ci
$env:CDK_OUTDIR = Join-Path $PWD 'cdk.out'
$env:CDK_CONTEXT_JSON = (Get-Content cdk.json -Raw | ConvertFrom-Json).context | ConvertTo-Json -Compress
node bin/offpeak.ts
Pop-Location
```

Inspect `infra/cdk.out/OffPeak.template.json` and `manifest.json`. Run this block in a fresh terminal and close it afterward so its CDK environment variables do not affect later commands. Synthesis creates a cloud assembly, as described in the [CDK synthesis documentation](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-synth.html); it proves neither IAM authorization nor runtime behavior.

Verified locally on October 19: typechecks, all 128 tests, Lambda packaging and the direct-app synthesis above passed. No AWS API calls were made for these checks.

For the local UI, use the checked-in `.env.example` defaults. In an existing private `.env`, remove any `POLLY_VOICE` setting, and ensure the shell also has no `POLLY_VOICE` value. Then explicitly select local adapters:

```powershell
$env:LLM_MODE = 'mock'
$env:RULE_PARSER = 'deterministic'
$env:STORE = 'memory'
$env:SCHEDULER = 'local'
$env:CLOCK = 'sim'
$env:DEVICES = 'sim'
$env:TARIFF_SOURCE = 'demo'
$env:VITE_MCP_URL = 'http://localhost:8787/mcp'
npm run dev
```

Open <http://localhost:5173>, use typed input and select Muted. Run the guided demo and inspect the MCP calls, approval checks and receipt. The expected proposal costs are $17.31 run-now and $9.57 proposed, a $7.74 modeled difference on synthetic rates. `STORE=memory` discards this terminal's demo state when the server exits. Stop with Ctrl+C; close the terminal to discard the environment overrides.

## 2. Optional account discovery for a later session

Use an existing account and an already configured profile. This project does not require creating or joining an AWS Organization, setting up Control Tower or upgrading an account plan. Do not paste credentials into this repository or a `VITE_*` variable.

The following commands discover identity and model metadata; they do not provision resources or invoke a model. Identity output includes private account and role identifiers, so keep it out of screenshots, commits and the submission. The [STS command reference](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html) describes that output.

```powershell
aws --version
aws configure list-profiles
$env:AWS_PROFILE = 'YOUR_EXISTING_PROFILE'
$env:AWS_REGION = 'us-east-1' # Use the region intended for the test.
$env:AWS_PAGER = ''
aws sts get-caller-identity --no-cli-pager
npm run bedrock:models
```

The helper calls [ListFoundationModels](https://docs.aws.amazon.com/cli/latest/reference/bedrock/list-foundation-models.html) and [ListInferenceProfiles](https://docs.aws.amazon.com/cli/latest/reference/bedrock/list-inference-profiles.html). A catalog entry does not prove that the account can invoke it, that the model supports Converse tool use, or that inference is free. Check the chosen model's current documentation and access requirements. An inference-profile ID may be needed instead of a base model ID; review its routing regions too. If access is denied, record the failure rather than broadening IAM permissions automatically.

## 3. Future Bedrock-only smoke test

**Deferred from this free pass.** Run this section only after the account owner approves a specific model, region and spending limit. Check the current [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) and any actual credits/allowances first. Do not assume a new account, catalog listing or budget alert makes inference free or enforces a hard spending cap.

The smallest useful test runs the existing local app with Bedrock conversation and keeps storage, scheduling, devices and rules local. No Lambda, DynamoDB, Scheduler or Polly deployment is needed. Start with the local environment from section 1, stop its server, and change only:

```powershell
$env:AWS_PROFILE = 'YOUR_EXISTING_PROFILE'
$env:AWS_REGION = 'YOUR_APPROVED_REGION'
$env:BEDROCK_MODEL_ID = 'YOUR_ENABLED_TOOL_USE_MODEL_OR_PROFILE_ID'
$env:LLM_MODE = 'bedrock'
$env:RULE_PARSER = 'deterministic'
npm run dev
```

1. Verify `http://localhost:8787/llm/config` reports `mode: bedrock`, the intended model/region and `tts: browser`. Keep the simulator in conversation mode, not scripted mode, and mute speech.
2. Send one typed request: **"What is the electricity price right now?"** Check for a real successful `/llm/converse` response with `mode: bedrock`, observed `get_price_now` MCP execution, and a final response based on that tool's result. A configuration label alone is insufficient. OffPeak implements the [client-side Bedrock tool loop](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html): the browser executes the MCP tool and returns its result to the model.
3. If still within the agreed limit, request the evening appliance plan. Confirm a real `plan_tasks` call and that no jobs exist before approval. Type **"Do it"** once, then confirm `apply_plan`, the stored plan and scheduled local jobs. Record failures honestly; do not substitute a scripted response as evidence of Bedrock success.
4. Capture sanitized request counts, model usage fields, tool names, outcomes and elapsed time. One user turn can make multiple inference requests, and SDK retries can add attempts. The proxy's 1,024 output-token setting is per request, not a monetary cap. Stop on an error or the agreed request/time limit; avoid repeated retries.
5. Stop the dev server with Ctrl+C and close the terminal. Confirm any edited private configuration is back in mock mode before starting another demo. Check account usage/costs when available; do not claim zero cost from an immediate empty billing view.

This establishes live Bedrock conversation/tool-use evidence only if the observed calls succeed. Devices and electricity savings remain simulated, and the public Workers deployment remains in mock mode.

## 4. Deployed AWS validation is separate

The optional stack includes Lambda, DynamoDB and EventBridge Scheduler, with optional Bedrock/Polly. Its current Function URL uses auth `NONE`; CORS does not authenticate callers. Add authentication and abuse controls before exposing a credential-backed LLM proxy publicly. See the [AWS deployment instructions and teardown boundary](../README.md#aws-deployment).

Do not run `cdk bootstrap`, `cdk deploy`, create schedules, enable Polly or change account plans as part of this free validation pass. A later deployment needs a reviewed resource list, account/region, budget, access controls and cleanup plan. Deleting the stack destroys its table data; inspect runtime-created schedules, logs and bootstrap resources separately. A passing Bedrock-only local test does not validate any of these deployed services.

## Evidence to keep for judges

| Evidence | Supports | Does not establish |
| --- | --- | --- |
| Typechecks, injected-client tests, Lambda bundle, local synthesis | Implemented AWS adapters and buildable infrastructure | Live AWS access or deployment |
| Identity/catalog discovery | Selected account context and available metadata | Model permission, tool compatibility or inference success |
| Successful Bedrock responses plus MCP tool/result round trip | Live Bedrock integration for the recorded model, region and date | Lambda/DynamoDB/Scheduler use, real Alexa+, real devices or bill savings |
| Actual authenticated deployment and service-specific observations | Only the AWS services exercised and recorded | Untested integrations or contest eligibility |

Use this template only after performing a test. Keep raw responses and account identifiers private; record public-safe summaries in `DECISIONS.md`, `FEEDBACK.md` and the AWS section of `SUBMISSION.md`:

```text
Date and source commit:
Scope: offline / catalog only / live Bedrock / deployed AWS
Region and public model or profile ID (omit account-specific ARNs):
Commands and environment mode (no credentials):
Observed inference requests and input/output token usage:
Observed MCP tool -> result -> model response:
Plan proposed / no jobs before approval / apply after confirmation:
Result, errors and limitations:
Estimated or later-observed cost, with time checked:
Cleanup performed; resources left running:
Public-safe screenshot or evidence location:
```

Until a live test is completed, use this submission wording: **"AWS SDK integrations are implemented and locally tested. The public demo runs on Cloudflare with mock conversation. No live AWS-service validation was performed in this pass."**
