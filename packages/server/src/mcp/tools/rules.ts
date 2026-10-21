import { joinAnd, ruleSummary } from "@off-peak/core";
import { z } from "zod";
import { addRule, removeRule } from "../../services/rules.ts";
import { defineTool } from "../defineTool.ts";

const ruleListSchema = z.array(z.object({ id: z.string(), type: z.string(), summary: z.string() }));

export const addRuleTool = defineTool({
  name: "add_rule",
  title: "Add a household rule",
  description:
    "Save a household rule from plain language. Supported: quiet hours for noisy appliances, a charge/finish deadline, a comfort temperature range, never turn off a device, ask before turning off a device, and a maximum household load. Rules always win over saving money. " +
    "Use for: 'nothing loud after 10', 'car at 80% by 7 on weekdays', 'never run the dryer after 9 PM', 'never turn off the fish tank', 'ask me before turning off the TV', 'don't go over 8 kilowatts'.",
  input: { text: z.string().min(3).describe("The rule as the user said it") },
  output: {
    rule: z.object({ id: z.string(), type: z.string(), summary: z.string() }),
    confirmationText: z.string(),
    replaced: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const { r, h } = await rt.withLock(async () => {
      const h = await rt.household();
      const r = await addRule(rt, h, args.text);
      return { r, h };
    });
    rt.changed("rule");
    return {
      text: r.confirmationText,
      data: { rule: { id: r.rule.id, type: r.rule.type, summary: ruleSummary(r.rule, h) }, confirmationText: r.confirmationText, replaced: r.replaced },
    };
  },
});

export const listRulesTool = defineTool({
  name: "list_rules",
  title: "List household rules",
  description: "List the household's rules (quiet hours, deadlines, never-off devices, comfort range, load limit). Use for: 'what are my rules?', 'what won't you turn off?'",
  input: {},
  output: { rules: ruleListSchema },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(_args, rt) {
    const h = await rt.household();
    const rules = h.rules.map((r) => ({ id: r.id, type: r.type, summary: ruleSummary(r, h) }));
    const never = h.rules.filter((r) => r.type === "never_off").length;
    const others = rules.filter((r) => r.type !== "never_off").map((r) => r.summary);
    // Speak every rule (grouping never-off devices) so the count and the list always agree.
    const items = [...others, ...(never ? [`never turning off ${never} ${never === 1 ? "device" : "devices"}`] : [])];
    const text = rules.length
      ? `You have ${rules.length} ${rules.length === 1 ? "rule" : "rules"}: ${joinAnd(items)}.`
      : "You don't have any rules yet.";
    return { text, data: { rules } };
  },
});

export const removeRuleTool = defineTool({
  name: "remove_rule",
  title: "Remove a household rule",
  description:
    "Delete a household rule by its id (from list_rules) or a short description such as 'quiet hours', 'the load limit', 'the car deadline', or 'ask first for the TV'. " +
    "Use for: 'drop the quiet hours rule', 'remove the load limit', 'you can turn off the aquarium now'.",
  input: { ruleId: z.string().min(1).describe("ruleId from list_rules, or e.g. 'quiet hours'") },
  output: { removed: z.object({ id: z.string(), type: z.string(), summary: z.string() }), rules: ruleListSchema },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const { removed, h } = await rt.withLock(async () => {
      const h = await rt.household();
      const before = structuredClone(h);
      const removed = await removeRule(rt, h, args.ruleId);
      return { removed: { id: removed.id, type: removed.type, summary: ruleSummary(removed, before) }, h };
    });
    rt.changed("rule");
    return {
      text: `Okay, I removed the rule: ${removed.summary}.`,
      data: { removed, rules: h.rules.map((r) => ({ id: r.id, type: r.type, summary: ruleSummary(r, h) })) },
    };
  },
});
