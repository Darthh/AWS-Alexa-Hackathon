# Feature requests for Alexa+ add-ons

These came out of building Off-Peak. Each one would turn a simulated part of our demo into something real.

### 1. Let add-ons read Alexa occupancy and Hunches signals, with customer consent
- **What:** A consented, read-only stream of room occupancy (Echo ultrasound / motion sensors) and Hunches state ("probably away", "probably asleep") exposed to MCP add-ons, for example as a resource the add-on can subscribe to.
- **Why it matters:** Presence is half of energy savings. Today Off-Peak has to be *told* "we're heading out" or "it's just me in the office". Alexa already knows, but add-ons can't see it. With consent, idle-off and away mode would happen without anyone remembering to say anything. That's where most standby waste hides.
- **Urgency:** critical

### 2. Proactive announcements from add-ons
- **What:** Let an add-on ask Alexa to announce or notify, rate-limited and user-controllable: "The car is charged to 80%." "Peak starts in 15 minutes; the dryer will wait until 9." "You left the office PC on; want me to turn it off?"
- **Why it matters:** Scheduling only builds trust if people hear what happened. Our ledger and `explain` answer *when asked*. A short proactive confirmation at the right moment ("Done: dishes ran overnight for 30¢") is what makes people leave automation on.
- **Urgency:** important

### 3. Read (and, with consent, control) Alexa-connected smart home devices from an add-on
- **What:** Scoped access for add-ons to the state of Alexa-connected devices (plugs, lights, thermostats, EV chargers, appliances), plus control through the same permission model the customer already uses in the Alexa app.
- **Why it matters:** Off-Peak ships a simulated home and an optional Home Assistant adapter because there's no way to reach the devices the customer already set up in Alexa. Reusing Alexa's device graph means no second app, no second account linking, and the same "never touch the fridge" protections the customer sees in Alexa.
- **Urgency:** critical

### 4. A public Alexa+ add-on simulator for developers outside the preview
- **What:** A hosted or local Alexa+ test harness that connects to a developer's MCP server, runs real Alexa+ routing and speech over it, and shows the screen output on Echo Show form factors. It should support MCP Apps and capture traces.
- **Why it matters:** Every hackathon team rebuilt a fake Alexa: an LLM loop, a system prompt, speech, a screen frame. That time could have gone into the add-on. A shared simulator would also standardize what "speakable" tool output and screen rendering look like, and catch routing problems (tool descriptions, `instructions`) before certification.
- **Urgency:** important

### 5. Document how Alexa+ uses MCP tool annotations, `instructions`, and `_meta.ui`
- **What:** Publish which server-supplied signals Alexa+ uses for routing and confirmation: tool `annotations` (`destructiveHint` → ask before acting?), the `instructions` string from `initialize`, `outputSchema`, and MCP Apps `_meta.ui.resourceUri` on Echo Show.
- **Why it matters:** We set annotations carefully, wrote routing-oriented descriptions, and built an MCP App, but couldn't confirm Alexa+ reads any of them. Clear guidance would make add-ons safer (confirm destructive actions) and better on screen devices.
- **Urgency:** nice-to-have
