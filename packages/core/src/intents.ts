/**
 * Deterministic intent router for the demo utterances (no LLM). Used by the web client's scripted mode
 * (the video backup) and by the server's mock LLM so both behave identically.
 */

export interface IntentContext {
  /** Ledger entry from the last `explain` ("turn it back on" undoes exactly that). */
  lastEntryId?: string;
  /** Plans from the last `find_rate_plans` ("use the first one"). */
  ratePlans?: { rateId: string; name: string }[];
}

export interface ToolCallIntent {
  tool: string;
  args: Record<string, unknown>;
}

export interface Intent {
  name: string;
  calls: ToolCallIntent[];
  /** Spoken when no tool applies. */
  fallback?: string;
}

const APPLIANCE = /\b(car|ev|tesla|dish(es|washer)?|laundry|wash(er|ing)?|dryer|clothes)\b/;
const ORDINALS: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, last: -1 };

function clean(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9:%' ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^alexa(?: |$)/, "");
}

/** "7" → "07:00" (morning deadline), "6:30" → "06:30", "7 am" → "07:00", "10 pm" → "22:00". */
function morningClock(hour: string, minute = "00", meridiem?: string): string {
  let h = Number(hour);
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function planTasks(t: string): ToolCallIntent | null {
  if (!APPLIANCE.test(t)) return null;
  const tonight = /\b(tonight|overnight|this evening|by morning)\b/.test(t);
  const tasks: Record<string, unknown>[] = [];
  if (/\b(car|ev|tesla)\b/.test(t)) {
    const task: Record<string, unknown> = { device: "car" };
    const by = /\b(?:car|ev|tesla)\b[^,.;]*?\bby (\d{1,2})(?::(\d{2}))? ?(am|pm)?/.exec(t);
    if (by) task.finishBy = morningClock(by[1]!, by[2], by[3]);
    const pct = /(\d{1,3}) ?(?:%|percent)/.exec(t);
    if (pct) task.targetPercent = Number(pct[1]);
    tasks.push(task);
  }
  if (/\bdish(es|washer)?\b/.test(t)) tasks.push({ device: "dishwasher", ...(tonight ? { finishBy: "tonight" } : {}) });
  if (/\b(laundry|clothes)\b/.test(t) || /\bwash(er|ing)?\b(?! ?dish)/.test(t)) tasks.push({ device: "washer", ...(tonight ? { finishBy: "tonight" } : {}) });
  if (/\b(laundry|clothes|dryer)\b/.test(t)) tasks.push({ device: "dryer", ...(tonight ? { finishBy: "tonight" } : {}) });
  return tasks.length ? { tool: "plan_tasks", args: { tasks } } : null;
}

function timeAfter(word: string, t: string): string | undefined {
  const m = new RegExp(`\\b${word} (\\d{1,2}(?::\\d{2})? ?(?:am|pm)?|midnight|noon)`).exec(t);
  return m?.[1]?.trim();
}

/** Map one utterance to MCP tool calls. */
export function routeUtterance(utterance: string, ctx: IntentContext = {}): Intent {
  const t = clean(utterance);
  const one = (name: string, tool: string, args: Record<string, unknown> = {}): Intent => ({ name, calls: [{ tool, args }] });

  if (!t) return { name: "empty", calls: [], fallback: "Sorry, I didn't catch that." };

  // Trust: undo / explain
  if (/\b(turn|switch|put) (it|that|them) back on\b|\bput (it|that|everything) back\b/.test(t)) {
    return one("undo", "undo", ctx.lastEntryId ? { actionId: ctx.lastEntryId } : {});
  }
  if (/^(undo|undo that|reverse that|take that back)\b/.test(t)) return one("undo", "undo");
  const why = /\bwhy (?:did|is|was|does|has) (?:the |my )?(.+?) (?:turn|go|get|switch|run|start|charg|stop|shut|scheduled|off|on|at)\b/.exec(t);
  if (why) return one("explain", "explain", { device: why[1]!.trim() });
  if (/^(why|what did you (just )?do)\b/.test(t)) return one("explain", "explain");

  // Savings
  if (/\b(save|saved|saving|savings)\b/.test(t)) {
    const period = /\b(week|weekly)\b/.test(t) ? "week" : /\bmonth\b/.test(t) ? "month" : "today";
    return one("savings", "get_savings", { period });
  }

  // Confirmation of a proposed plan
  if (/^(yes|yeah|yep|sure|ok|okay|do it|go ahead|sounds good|please do|apply it|schedule it|let's do it)\b/.test(t)) {
    return one("apply", "apply_plan");
  }
  if (/\bcancel\b|\bdon't run\b|\bstop charging\b/.test(t)) {
    const dev = /\b(car|dishwasher|dishes|washer|dryer|laundry)\b/.exec(t)?.[1];
    return one("cancel", "cancel_plan", dev ? { device: dev === "dishes" ? "dishwasher" : dev === "laundry" ? "washer" : dev } : {});
  }

  // Presence
  if (/\b(heading out|leaving|going out|we're out|i'm out|out until|away until|out for the (evening|night|day))\b/.test(t)) {
    const until = timeAfter("until", t) ?? timeAfter("back at", t) ?? timeAfter("till", t);
    return one("away", "set_mode", { mode: "away", ...(until ? { returnAt: until } : {}) });
  }
  const arriving = /\b(be home|home in|on (my|our) way|heading home|arriving|be back)\b/.exec(t);
  if (arriving) {
    const mins = /\bin (\d+) ?(minutes?|mins?)\b/.exec(t);
    const hours = /\bin (an?|one|\d+) hours?\b/.exec(t);
    const at = timeAfter("at", t) ?? timeAfter("by", t);
    const eta = mins ? Number(mins[1]) : hours ? (hours[1] === "a" || hours[1] === "an" || hours[1] === "one" ? 60 : Number(hours[1]) * 60) : at;
    if (eta !== undefined) return one("arriving", "arriving", { eta });
  }
  if (/\b(we're|i'm|i am|we are) (back|home)\b|\bwe're back\b/.test(t)) return one("home", "set_mode", { mode: "home" });
  if (/\b(going to bed|good ?night|bed ?time|sleep mode|off to bed)\b/.test(t)) return one("sleep", "set_mode", { mode: "sleep" });
  const zone = /\b(?:just me|only me|only using|just using|i'm only in|only in|i'm working) (?:in )?(?:the )?([a-z ]+?)(?: room)?(?: now| tonight| today)?$/.exec(t);
  if (zone) return one("zone", "set_mode", { mode: "zone", activeZones: [zone[1]!.trim()] });

  // Standing rules phrased as "never/don't run X after T" (otherwise they'd look like a planning request)
  if (/^(never|don't|do not|no) (ever )?(run|running|start|starting|use|using)\b/.test(t) && /\b(after|past|later than)\b/.test(t) && !/\b(until|till|before)\b/.test(t)) {
    return one("add_rule", "add_rule", { text: utterance.trim() });
  }
  if (/^(remove|drop|delete|forget) (the |my )?.*\brule\b|^(remove|drop|delete) (the |my )?(load limit|quiet hours)/.test(t)) {
    const ref = t.replace(/^(remove|drop|delete|forget) (the |my )?/, "").replace(/\brule\b/, "").trim();
    return one("remove_rule", "remove_rule", { ruleId: ref || "rule" });
  }

  // Planning (before rules: "nothing loud after 10" often rides along)
  if (/\b(cheapest|best time|when should i|when's the cheapest|when is the cheapest)\b/.test(t)) {
    // "Run it when cheapest" requests a proposal; "When is cheapest?" only asks for information.
    const requestsAction = /^(?:please )?(?:(?:can|could|would) you (?:please )?)?(?:run|start|schedule|plan|charge|wash)\b/.test(t);
    const proposal = requestsAction ? planTasks(t) : null;
    if (proposal) return { name: "plan", calls: [proposal] };
    const dev = /\b(car|dishwasher|dishes|washer|dryer|laundry)\b/.exec(t)?.[1];
    const dur = /(\d+) ?(hours?|minutes?)/.exec(t);
    return one("cheapest", "find_cheapest_window", {
      ...(dev ? { device: dev === "dishes" ? "dishwasher" : dev === "laundry" ? "washer" : dev } : {}),
      ...(!dev && dur ? { durationMinutes: Number(dur[1]) * (dur[2]!.startsWith("h") ? 60 : 1) } : {}),
    });
  }
  const plan = /\b(charge|charged|run|done|do|wash|finish|plan|start|tonight)\b/.test(t) ? planTasks(t) : null;
  if (plan) return { name: "plan", calls: [plan] };

  // Rate plans
  const zip = /\b(\d{5})\b/.exec(t);
  if (zip && /\b(zip|rate|plan|utility|tariff|live in|i'm in|we're in)\b/.test(t)) return one("rates", "find_rate_plans", { zip: zip[1] });
  if (/\bdemo rate\b/.test(t)) return one("select_rate", "select_rate_plan", { rateId: "DEMO_TOU" });
  const pick = /\b(?:use|switch to|pick|choose) (?:the )?(first|second|third|fourth|last|1st|2nd|3rd) (?:one|plan)?/.exec(t);
  if (pick && ctx.ratePlans?.length) {
    const i = ORDINALS[pick[1]!]!;
    const plan = i < 0 ? ctx.ratePlans.at(-1) : ctx.ratePlans[i];
    if (plan) return one("select_rate", "select_rate_plan", { rateId: plan.rateId });
  }

  // Rules
  if (/\b(what are my rules|list (my )?rules|what rules)\b/.test(t)) return one("list_rules", "list_rules");
  if (/^(never|always keep|ask me|ask before|don't go over|do not go over|keep (it|the house|the)|nothing (loud|noisy)|no noisy|quiet hours|make sure)\b/.test(t)) {
    return one("add_rule", "add_rule", { text: utterance.trim() });
  }

  // Prices and status
  if (/\b(price|cost|how much is (power|electricity)|is it peak|peak time|when does peak)\b/.test(t)) return one("price", "get_price_now");
  if (/\b(what's going on|whats going on|status|what's scheduled|what is scheduled|what's running|wasting|show me the plan)\b/.test(t)) {
    return one("status", "get_home_status");
  }

  // Direct control
  const set = /\bset (?:the )?(thermostat|ac|temperature|water heater) to (\d{2}|eco|normal)\b/.exec(t);
  if (set) return one("control", "control_device", { device: set[1], action: "set", value: /^\d+$/.test(set[2]!) ? Number(set[2]) : set[2] });
  const on1 = /\b(?:turn|switch) (on|off) (?:the |my )?(.+)$/.exec(t);
  const on2 = /\b(?:turn|switch) (?:the |my )?(.+?) (on|off)\b/.exec(t);
  const dev = (x: string) => x.replace(/\b(back|again|please|now)\b/g, " ").replace(/\s+/g, " ").trim();
  if (on1) return one("control", "control_device", { device: dev(on1[2]!), action: on1[1] });
  if (on2) return one("control", "control_device", { device: dev(on2[1]!), action: on2[2] });

  return {
    name: "unknown",
    calls: [],
    fallback: "Sorry, I can't help with that in scripted mode. Try asking about tonight's plan, leaving home, or what you saved.",
  };
}
