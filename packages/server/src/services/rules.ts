import {
  confirmRule,
  normalizeRef,
  OffPeakError,
  ruleSummary,
  type Household,
  type Rule,
  type RuleBody,
} from "@off-peak/core";
import type { Runtime } from "../runtime.ts";

/** One rule per (type, device) — a new deadline for the car replaces the old one; quiet hours/max load are singletons. */
function sameSlot(a: Rule | RuleBody, b: Rule | RuleBody): boolean {
  if (a.type !== b.type) return false;
  if ("deviceId" in a && "deviceId" in b) return a.deviceId === b.deviceId;
  if (a.type === "comfort" && b.type === "comfort") return a.zoneId === b.zoneId && a.when === b.when;
  return true;
}

export async function addRule(rt: Runtime, h: Household, text: string): Promise<{ rule: Rule; confirmationText: string; replaced: boolean }> {
  const body = await rt.ruleParser.parse(text, h);
  if (!body) {
    throw new OffPeakError(
      "invalid_input",
      "I didn't catch that rule. Try something like 'nothing loud after 10' or 'car charged by 7'.",
      { text },
    );
  }
  const existing = h.rules.find((r) => sameSlot(r, body));
  const rule = { ...body, id: existing?.id ?? rt.newId("rule") } as Rule;
  h.rules = existing ? h.rules.map((r) => (r.id === existing.id ? rule : r)) : [...h.rules, rule];
  if (rule.type === "never_off") {
    const d = h.devices.find((x) => x.id === rule.deviceId);
    if (d) d.neverOff = true;
  }
  await rt.store.saveHousehold(h);
  return { rule, confirmationText: confirmRule(rule, h), replaced: Boolean(existing) };
}

/** Words people use for each kind of rule ("remove the load limit", "drop quiet hours"). */
const RULE_WORDS: Record<Rule["type"], string[]> = {
  quiet_hours: ["quiet", "quiet hours", "noise", "noisy", "loud"],
  deadline: ["deadline", "charged by", "done by", "ready by", "by"],
  comfort: ["comfort", "temperature", "degrees", "thermostat range"],
  never_off: ["never off", "never turn off", "always on", "keep on"],
  ask_first: ["ask first", "ask me", "ask before", "check with me"],
  max_load: ["load", "load limit", "max load", "power limit", "kilowatt", "kw", "limit"],
};

const RULE_WORD_SET = new Set(Object.values(RULE_WORDS).flat());

export function findRule(h: Household, ref: string): Rule {
  const exact = h.rules.find((r) => r.id === ref);
  if (exact) return exact;
  const n = normalizeRef(ref).replace(/_/g, " ").replace(/\b(rule|rules|remove|drop|delete)\b/g, " ").replace(/\s+/g, " ").trim();
  const words = new Set(n.split(" ").filter(Boolean));
  const scored = h.rules.map((r) => {
    const summary = normalizeRef(ruleSummary(r, h));
    let score = 0;
    if (n && (summary.includes(n) || r.type.replace(/_/g, " ").includes(n) || n.includes(r.type.replace(/_/g, " ")))) score += 3;
    for (const w of RULE_WORDS[r.type]) if (` ${n} `.includes(` ${w} `)) score += w.includes(" ") ? 2 : 1;
    // A device mention ("the car deadline", "ask first for the TV") narrows to that device's rules.
    if ("deviceId" in r) {
      const d = h.devices.find((x) => x.id === r.deviceId);
      // "temperature" is both a thermostat alias and a comfort-rule word; the rule word wins.
      const names = d ? [d.name, d.id.replace(/_/g, " "), ...d.aliases].map((x) => normalizeRef(x)).filter((x) => !RULE_WORD_SET.has(x)) : [];
      if (names.some((x) => x && (` ${n} `.includes(` ${x} `) || words.has(x)))) score += 2;
    }
    return { r, score };
  });
  const best = Math.max(0, ...scored.map((x) => x.score));
  const matches = best > 0 ? scored.filter((x) => x.score === best).map((x) => x.r) : [];
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new OffPeakError("ambiguous", `Which rule: ${matches.map((r) => ruleSummary(r, h)).join(", or ")}?`);
  throw new OffPeakError("not_found", "I couldn't find that rule. Ask me to list your rules to hear them all.");
}

export async function removeRule(rt: Runtime, h: Household, ref: string): Promise<Rule> {
  const rule = findRule(h, ref);
  h.rules = h.rules.filter((r) => r.id !== rule.id);
  if (rule.type === "never_off") {
    const d = h.devices.find((x) => x.id === rule.deviceId);
    if (d && !["food", "network", "medical"].some((t) => d.tags?.includes(t as never))) d.neverOff = false;
  }
  await rt.store.saveHousehold(h);
  return rule;
}
