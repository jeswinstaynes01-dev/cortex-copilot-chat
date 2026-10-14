/**
 * effort.ts — the shared vocabulary for reasoning-effort levels.
 *
 * The runtime names these `none | low | medium | high | xhigh | max`. Those are
 * the values we send and they are never translated — but "xhigh" is not a word,
 * so each gets a readable label and a one-line explanation of what you are
 * actually buying.
 *
 * This lives in its own module because two separate surfaces present the same
 * six levels: the chip row in the model menu, and the `/effort` command in the
 * composer. A second copy of these strings would drift the moment one of them
 * was edited, and the drift would be invisible — both would still render
 * perfectly, just disagreeing about what "xhigh" means.
 *
 * A lookup rather than a formatter because the set is closed, small, and
 * defined by the server. If the runtime ever adds a level, `effortLabel()`
 * falls back to the raw name rather than hiding an option that genuinely
 * exists — an unfamiliar label is a much smaller failure than a missing one.
 */

const EFFORT_LABEL: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const EFFORT_HINT: Record<string, string> = {
  none: "Answer directly, with no reasoning step.",
  low: "Think briefly. Fastest useful setting.",
  medium: "A balanced amount of thinking.",
  high: "Think harder. Slower, better on tricky problems.",
  xhigh: "Think a lot. Noticeably slower.",
  max: "Think as hard as this model can. Slowest and most expensive.",
};

export function effortLabel(value: string): string {
  return EFFORT_LABEL[value] ?? value;
}

export function effortHint(value: string): string {
  return EFFORT_HINT[value] ?? "";
}

/** What the first chip means: send no effort at all and let the model decide.
 *  Distinct from the `none` level, which is an explicit instruction NOT to
 *  reason and which only some models offer. */
export const EFFORT_DEFAULT_LABEL = "Model default";
export const EFFORT_DEFAULT_HINT = "The model decides how long to think.";
