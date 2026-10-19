# tou-rates

Turn US residential electricity tariffs from the [OpenEI Utility Rate Database](https://openei.org/wiki/Utility_Rate_Database) into prices you can schedule against: "what does power cost at 9 PM?", "give me 15-minute price slots for tonight", "when is peak today?".

- **OpenEI client:** look up residential rate plans by ZIP. Current plans only, newest version of each, time-of-use plans first.
- **Normalizer:** converts a URDB rate into tier-1 cents per kWh per period, 12×24 weekday and weekend schedules, the fixed monthly charge, and human period names (super off-peak, off-peak, mid-peak, peak).
- **Price math:** `priceAt`, 15-minute `slots`, `nextChange`, and `describeDay` ("Peak 4–9 PM today; cheapest midnight–6 AM."). All of them work on local wall-clock hours, so DST days come out with 23 or 25 hours.
- **`DEMO_TOU`:** a synthetic rate (24/31/49 ¢/kWh) for demos and tests, always labeled "Demo rate (synthetic)".

It has one runtime dependency (Luxon) and no I/O beyond an injectable `fetch`. It was built for [Off-Peak](https://github.com/Darthh/AWS-Alexa-Hackathon), an Alexa+ add-on that moves appliances into cheap hours.

## Install

This project is published as an MIT-licensed [GitHub repository](https://github.com/Darthh/tou-rates), not as a release on the npm registry. Requires Node.js 22.18 or newer.

```bash
# Install from the public source repository; prepare builds the ESM output.
npm install git+https://github.com/Darthh/tou-rates.git
```

Or clone the standalone project and run `npm ci && npm test && npm run build`.

## Use

```ts
import { fetchRatePlans, priceAt, slots, describeDay, nextChange, DEMO_TOU } from "tou-rates";

// 1. Find plans for a ZIP (free key: https://openei.org/services/api/signup).
const plans = await fetchRatePlans("94610", process.env.OPENEI_API_KEY!, fetch, { timezone: "America/Los_Angeles" });
const tariff = plans[0]; // TOU plans first

// 2. Ask about prices.
priceAt(tariff, new Date());            // { centsPerKwh: 44.1, periodName: "peak", periodIndex: 0 }
nextChange(tariff, new Date());          // { at: "2026-10-19T21:00:00-07:00", periodName: "off-peak", ... }
describeDay(tariff, "2026-10-19");       // "Peak 4–9 PM today; cheapest midnight–4 PM and 9 PM–midnight."
slots(tariff, "2026-10-19T17:30:00-07:00", "2026-10-20T07:00:00-07:00"); // 15-minute PriceSlot[]

// No key? Use the synthetic demo rate.
describeDay(DEMO_TOU, "2026-10-19");     // "Peak 4–9 PM today; cheapest midnight–6 AM."
```

Normalize a URDB item yourself:

```ts
import { normalize } from "tou-rates";
const tariff = normalize(openEiItem, { timezone: "America/Los_Angeles" });
tariff.warnings; // e.g. ["Tiered pricing simplified to tier 1."]
```

## How normalization works

| Field | Rule |
|---|---|
| Price per period | `(tier[0].rate + tier[0].adj) × 100` ¢/kWh. If there is more than one tier, it adds the warning "Tiered pricing simplified to tier 1." |
| Schedules | `energyweekdayschedule` / `energyweekendschedule`, 12 months × 24 **local** hours. If they're missing, the rate becomes flat with a warning. |
| TOU? | `isTou` is true when any month's weekday hours have more than one price. |
| Period names | Assigned per month by price level: cheapest → super off-peak (with 3+ levels) or off-peak, priciest → peak, the rest → off-peak or mid-peak. A period index reused across seasons with a different rank is split, so each month names its own peak. |
| Fixed charge | `fixedmonthlycharge`, or `fixedchargefirstmeter` with `$/day`, `$/month`, or `$/year` units. |
| Which plans | `fetchRatePlans` drops expired rates (`enddate` in the past), keeps the newest version of each (utility, name), and asks the API for `orderby=startdate&direction=desc`. Without that ordering, years-old rates fill the page. |

## Limitations

- Tier 1 only. No baseline allowances, demand charges, or net metering / export credits.
- Utility holidays aren't modeled; holidays are priced as their weekday or weekend schedule.
- Prices are per slot start, so pass a `from` aligned to the step. TOU boundaries are on the hour.

## Develop

```bash
npm install
npm test        # vitest: real OpenEI fixtures, DST spring-forward / fall-back, naming edge cases
npm run build   # emits dist/ (ESM + .d.ts)
```

The fixtures in `fixtures/` are real OpenEI responses (PG&E E-TOU-C, PG&E EV2, SCE TOU-D-4-9PM), retrieved on 2026-10-19 and trimmed to the fields this library reads.

## License

MIT
