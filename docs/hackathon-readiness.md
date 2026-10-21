# Amazon Developer Hackathon readiness

Checked October 19 and re-checked October 21, 2026 against the [official rules](https://amazonappdev2026.devpost.com/rules) and [submission requirements](https://amazonappdev2026.devpost.com/).

The official deadline is **Friday, October 23, 2026 at 12:00 PM PDT**. The supplied build prompt says Thursday while using October 23; the official date takes precedence. The prompt's instruction to begin Milestone 0 in an empty repository is historical context. This pass extends the existing application and keeps the requested AWS-style console design.

## Evidence and entry checklist

| Item | Evidence | State |
| --- | --- | --- |
| Alexa+ track | Real SDK v1 browser client and MCP server; protocol 2025-11-25, Streamable HTTP, 17 tools | Implemented and live-tested |
| Source access and license | [OffPeak repository](https://github.com/Darthh/AWS-Alexa-Hackathon), root MIT license | Public; reviewers need no invitation |
| Usable demo | [Live console](https://offpeak.patrickvaldivia123.workers.dev), zero-key local path, guided walkthrough, native fallback | Implemented and tested |
| Coherent target experience | Dark 16:10 Echo Show screen at 960×600 with ≥ 24 px type and on-screen captions, Echo Dot voice-only mode, speech controls, large screen with Escape exit, cost/guardrail review, spoken errors | Implemented and browser-tested; microphone/audio depend on the browser |
| Customer impact evidence | $17.31 run-now task cost vs $9.57 proposed task cost; $7.74 modeled difference on the synthetic demo tariff | Fixture result; not a measured bill or annual forecast |
| Trust | Explicit plan approval, visible server-computed checks, stale/conflicting proposal rejection, reasons, undo, protected devices | Tested |
| Runtime evidence | Live Inspector and downloadable receipt; `npm run verify:submission` writes `out/submission-check.json` | Reproducible; does not certify contest eligibility |
| Feedback and friction | [FEEDBACK.md](../FEEDBACK.md), [FRICTION_LOG.md](../FRICTION_LOG.md), [FEATURE_REQUESTS.md](../FEATURE_REQUESTS.md) | Ready to copy into the appropriate Devpost fields |
| Open Source mini challenge | [Darthh/tou-rates](https://github.com/Darthh/tou-rates), MIT; 22 tests; separate build; public contribution commits | Published during the submission window |
| AWS Builder mini challenge | Bedrock/Polly SDK call sites, DynamoDB/Scheduler adapters, Lambda package and CDK stack | Implemented/offline-tested; no live AWS-service validation claimed |
| Demo video | Captioned 1600×1000 H.264 recording of the current build at `out/offpeak-demo.mp4`, about 113 seconds (re-recorded October 21); reproducible capture in [DEMO_SCRIPT.md](../DEMO_SCRIPT.md) | Local recording ready; public YouTube/Vimeo URL still required |
| Public demo URL | Cloudflare Workers deployment | Serves the October 19 build until `npm run deploy` is run with the team's Wrangler login |
| Fresh-clone quick start | `npm ci && npm run dev` with no `.env` | Fixed October 21 (Node 22 watch mode crashed on a missing `.env`) |
| Team details and eligibility | Repository owner: `Darthh`; other team members and entrant declarations require the team's confirmation | Do not invent names or eligibility assertions |
| Final submission | [SUBMISSION.md](../SUBMISSION.md) is prepared text | Devpost form has not been submitted |

## Open Source fields

- Contribution URL: <https://github.com/Darthh/tou-rates/commit/d2fb907>
- Project repository URL: <https://github.com/Darthh/tou-rates>
- GitHub username with a verified contribution: `Darthh`.
- What: an additional MIT TypeScript library that turns OpenEI residential tariffs into schedulable time-of-use prices.
- How: normalize schedules, tiers and fixed charges; expose timezone/DST-aware price lookup and price slots; include a synthetic tariff and 22 tests. It has no dependency on OffPeak's server or UI.
- Why: another energy project can reuse the tariff handling without adopting the Alexa+ simulator.

No npm registry release is claimed. The public source repository supports cloning/building and Git-based installation.

## Remaining submission work

1. Run `npm run deploy` so the public URL serves the October 21 build. Upload the demo recording to a public English-language YouTube or Vimeo page and paste that URL into Devpost. Keep it below three minutes; the capture includes only this application's UI and no third-party music or footage.
2. Confirm the team members and entrant declarations in Devpost. The build prompt's three-person team description does not establish who those people are.
3. Choose mini challenges using actual evidence. The Open Source contribution is public. Describe AWS services as implemented adapters unless the team completes a live validation; Kiro was not used in this build.
4. Copy the prepared description, feedback, friction, contribution links, and video URL into the entry before the official deadline. This agent pass does not accept contest terms or submit an entry on the team's behalf.

## Optional AWS validation

The user selected a free pass with validation instructions only. Follow the [AWS validation runbook](aws-validation.md) for reproducible local checks, optional future read-only discovery, a deferred Bedrock smoke test and an evidence template. No live AWS calls or resource creation were performed for this follow-up.

The public demo is hosted on Cloudflare, with mock conversation, simulated devices and local scheduling. Hosting there does not demonstrate AWS runtime use. Lambda bundling/asset packaging and CDK synthesis passed locally in this pass after fixing Windows path conversion; neither provisions resources.

For a live AWS validation, use an existing account and an explicitly approved budget, discover a model the account can use, exercise the existing Converse tool loop, and record the actual model, region, commands and sanitized outcomes. Never put credentials, account identifiers, private responses, or device tokens into the submission. The existing optional CDK stack needs access controls before public use; no Organization, Control Tower or paid-plan upgrade is needed for this work.
