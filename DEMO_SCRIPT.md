# Demo video script (target 2:50)

**Reproducible capture:** Run `npm run record:demo` to record the actual deployed seven-scene walkthrough as `out/offpeak-demo.webm` with English explanatory captions. The capture uses mock conversation, real MCP calls and synthetic rates. It adds no stock footage or music and does not upload anything. Set `DEMO_URL` to a local deployment for offline capture (for example `npm run dev:worker`, then `DEMO_URL=http://127.0.0.1:8790`). Google Chrome (or any Chromium via `PW_CHROMIUM_PATH`) and Playwright's FFmpeg helper are required.

Convert the saved WebM to MP4 with FFmpeg if desired. Inspect the recording and verify it is below 180 seconds, then upload it to **public YouTube or Vimeo** and paste that URL into Devpost. A local video or GitHub file URL does not satisfy that field.

**Actual public mode:** Mock LLM on Cloudflare. Live Bedrock and real Echo operation are not claimed. Click **Start guided demo** to inspect each scene before continuing. **Large screen** expands the simulator; Escape exits. **Download demo receipt** exports labeled runtime evidence.

**Captured October 21 (current build):** `out/offpeak-demo.mp4` is an actual 1600×1000 H.264 capture of the local Workers build, about **113 seconds** long (under three minutes), with English on-screen captions and the new Echo Show screen. It has no audio track; add a voice-over before uploading if you can. Scene timings are in `out/recording/scenes.json`; generated video is not committed to the source repository.

**Setup:** `npm run dev` (no `.env` needed), open http://localhost:5173 at 1440×1000 or larger, and click **Reset** on the sim clock (5:30 PM, demo rate).

- **Primary public brain:** Mock LLM. Bedrock remains optional and requires validation with an existing account and approved budget.
- **Backup:** open **http://localhost:5173/?mode=scripted**. Say so honestly in the submission if you use it.
- **Recording tips:**
  - Keep the MCP Inspector tab visible for scene 1 (switch the right-bottom tab).
  - Hold **space** to talk, or click the demo chips (same words).
  - Speech is the browser voice unless `POLLY_VOICE` is set.

| Time | Scene | Do / say | Expect |
|---|---|---|---|
| 0:00–0:15 | **Hook** | Point at the price strip on the sim clock (peak 4–9 PM in amber). Voice-over: "A cheap schedule is useless if the car's dead at 7 AM." | Price strip, "Peak 4–9 PM today; cheapest midnight–6 AM." |
| 0:15–1:05 | **5:30 PM: plan** | Say: "I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10." | The dark Echo Show screen shows the **Proposed plan**: washer now, dryer 9–10 PM, dishwasher and car overnight, "Saves $7.74", quiet hours shaded, "by 7 AM" deadline. Alexa: "Here's the plan… about $7.74 cheaper… Should I go ahead?" |
| | | Switch to the **MCP Inspector** tab, then say: "Do it." | Inspector shows `tools/call plan_tasks` → `tools/call apply_plan` (plus `initialize`, `tools/list` at the top). Alexa: "Done, it's all scheduled. The washer is starting now, and the car will be at 80% by 4:45 AM." The washer lights up in the house panel. |
| 1:05–1:40 | **6:45 PM: leaving** | Press **→ 6:45 PM**. Say: "We're heading out until 9." | House panel goes dark: TV, console, soundbar, lamps, PC, printer, speaker plug, fan off. **Fridge, Wi-Fi router, aquarium stay lit (🔒)**, the washer keeps running, thermostat shows 82°F, water heater eco. Alexa: "…Cooling starts at 9 PM, when peak ends." |
| 1:40–2:00 | **Trust** | Say: "Why did the TV turn off?" | "The TV turned off at 6:45 PM because you left home and it was drawing 15 watts on standby. Want me to turn it back on?" |
| | | Say: "Turn it back on." | "Done, the TV is back the way it was." The TV is lit again; the ledger row is struck through. |
| 2:00–2:20 | **7 AM: results** | Press **→ 7 AM**. Show the car at **80%** in the garage and the ledger filled in (dryer 9 PM, car and dishwasher at midnight, restore at 9 PM). Say: "How much did Off-Peak save me today?" | Savings screen: **$7.74** today, split by source, with top wins. Alexa: "Off-Peak saved you about $7.74 today on the demo rate, counting the whole overnight schedule. Most of it came from running things off-peak." |
| 2:20–2:35 | **Next evening: one room** | Press **→ 5:30 PM**. Say: "It's just me in the office." Then click **Echo Show** in the simulator toolbar to switch to **Voice-only (Echo Dot)**. | Living room, kitchen, and bedroom go dark; the office stays on; the whole-home thermostat isn't touched. Echo Dot ring + captions only: "Okay, just the office: I turned off 7 things in the other rooms, but the fridge stays on." |
| 2:35–2:50 | **Close** | Show the protocol Inspector and public MIT tariff library. Describe AWS adapters as optional and offline-tested unless live validation has been completed. Voice-over: "Rules, then presence, then price." | End on the savings number. |

**Extras if time allows:**
- "When's the cheapest time to run the dishwasher?"
- "Never turn off the fish tank."
- Turn off the fish tank: Alexa asks for confirmation.
- At 9:30 PM, "Do the laundry tonight": "I can't fit the washer before quiet hours start at 10 PM. Should I allow it during quiet hours or finish by 9:30 AM tomorrow instead?"
- "Never run the dryer after 9 PM" (a new rule), then "What are my rules?" and "Remove the load limit".
- "Turn off the light": Alexa asks which light instead of guessing.

**If something goes wrong on camera:** click **Reset** (clock + house), reload the page, and use `?mode=scripted`.
