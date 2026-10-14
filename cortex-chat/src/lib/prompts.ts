/**
 * prompts.ts — the prompt library behind `/prompt`, `/save` and `/unsave`.
 *
 * Two sources, one list. The built-ins are the QA jobs that come round every
 * week — test cases from a story, a regression scope, a bug report from rough
 * notes — written carefully once, so nobody retypes them badly under pressure.
 * The saved ones are the user's own, kept in localStorage beside the chats.
 *
 * A prompt is never sent by choosing it. It goes into the composer instead,
 * because every built-in ends on a label line ("Story:") and the part that
 * matters — the story, the notes, the endpoint — is what gets pasted under it.
 * Sending the template alone would ask the agent about nothing.
 */

export interface Prompt {
  id: string;
  name: string;
  text: string;
  /** Ships with the app. Built-ins cannot be removed, only saved ones can. */
  builtIn: boolean;
}

/* Versioned for the same reason the chat store is: the day the shape changes,
   a new key starts clean instead of misreading what an old build wrote. */
export const PROMPTS_KEY = "cortex.prompts.v1";

/** Long enough to recognise a prompt in a list, short enough to fit a row. */
const NAME_LIMIT = 40;

const builtIn = (id: string, name: string, text: string): Prompt => ({
  id: `builtin:${id}`,
  name,
  text,
  builtIn: true,
});

export const BUILT_IN_PROMPTS: Prompt[] = [
  builtIn(
    "test-cases",
    "Test cases from a story",
    `Act as a senior QA engineer and write test cases for the user story below.

Cover positive, negative, boundary and edge cases. Respect the preconditions: treat mandatory and optional fields differently, and include a case for each mandatory field left empty.

Output one table with these columns:
ID | Scenario | Preconditions | Steps | Expected result | Priority

Make every expected result specific and observable. Use High, Medium or Low for priority.

Story:
`,
  ),
  builtIn(
    "regression-scope",
    "Regression scope",
    `Act as a senior QA engineer and decide what to retest for the change below.

List the areas to retest, ranked by risk from highest to lowest, with a one-line reason for each. Then list what is safe to skip this time, and why.

Change:
`,
  ),
  builtIn(
    "bug-report",
    "Bug report from notes",
    `Turn my rough notes below into a clear bug report with these sections:
Title, Environment, Preconditions, Steps to reproduce, Expected, Actual, Severity, Priority, Evidence.

Number the steps so someone who has never seen the feature can reproduce it. If my notes do not say something, write "TBD" rather than inventing it.

Notes:
`,
  ),
  builtIn(
    "boundary-values",
    "Boundary values",
    `Apply boundary-value analysis and equivalence partitioning to the field or rule below.

List the valid and invalid partitions, then the values to test just below, on and just above each limit. Give the expected outcome for every value.

Field or rule:
`,
  ),
  builtIn(
    "api-checklist",
    "API test checklist",
    `Write an API test checklist for the endpoint below. Cover:
- status codes, for success and for every error it can return
- response schema validation
- authentication and authorisation
- negative inputs: missing, malformed and out-of-range fields
- idempotency
- pagination
- performance: response time and payload size

Endpoint:
`,
  ),
  builtIn(
    "review-cases",
    "Review my test cases",
    `Review the test cases below. Point out gaps in coverage, duplicates, and any expected result that is unclear or cannot be verified. Then suggest the missing cases in the same format as mine.

Test cases:
`,
  ),
];

/* Only the two calls this file makes, so a test can hand in a plain object
   and the real thing is never touched. */
export type PromptStore = Pick<Storage, "getItem" | "setItem">;

/* Reading `localStorage` can itself throw — a sandboxed iframe, or storage
   disabled outright — so even finding the store is guarded. */
function defaultStore(): PromptStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const uid = () => `saved:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * The user's saved prompts, newest first.
 *
 * Anything unreadable — not JSON, not an array, an entry missing its text —
 * is skipped rather than allowed to throw. The library is a convenience on
 * top of the chat; a bad entry must never stop the composer from opening.
 */
export function loadSavedPrompts(store: PromptStore | null = defaultStore()): Prompt[] {
  let parsed: unknown;
  try {
    const raw = store?.getItem(PROMPTS_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const ids = new Set<string>();
  const out: Prompt[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, text } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof text !== "string") continue;
    if (!name.trim() || !text.trim()) continue;
    /* Names are how prompts are told apart in the list, so a hand-edited
       store with two of the same name keeps the first and drops the rest. */
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    /* A missing or repeated id is replaced by one derived from the name,
       which is unique by now. Derived rather than random, because the store
       is re-read on every change: a fresh id per read would leave the row
       impossible to delete, since the id the list showed is gone by then. */
    const stableId = typeof id === "string" && id && !ids.has(id) ? id : `saved:${key}`;
    ids.add(stableId);
    out.push({ id: stableId, name: name.trim(), text, builtIn: false });
  }
  return out;
}

function persist(prompts: Prompt[], store: PromptStore | null) {
  try {
    store?.setItem(
      PROMPTS_KEY,
      JSON.stringify(prompts.map(({ id, name, text }) => ({ id, name, text }))),
    );
  } catch {
    /* Private mode, quota, disabled storage — the prompt still works for the
       rest of this visit, which is better than refusing to save it at all. */
  }
}

/**
 * Saves `text` under `name`, or under a name taken from the text itself when
 * none is given. Saving over an existing name replaces it — case-insensitively,
 * the same way the list is searched — rather than leaving two rows nobody can
 * tell apart. Returns the new list, newest first.
 */
export function savePrompt(
  name: string,
  text: string,
  store: PromptStore | null = defaultStore(),
): Prompt[] {
  const current = loadSavedPrompts(store);
  if (!text.trim()) return current;
  const finalName = name.trim() || defaultPromptName(text);
  const key = finalName.toLowerCase();
  const next = [
    { id: uid(), name: finalName, text, builtIn: false },
    ...current.filter((p) => p.name.toLowerCase() !== key),
  ];
  persist(next, store);
  return next;
}

/** Removes a saved prompt by id. Built-in ids match nothing, so they stay. */
export function deletePrompt(id: string, store: PromptStore | null = defaultStore()): Prompt[] {
  const current = loadSavedPrompts(store);
  const next = current.filter((p) => p.id !== id);
  if (next.length !== current.length) persist(next, store);
  return next;
}

/** The saved prompt a name would replace, if any. */
export function findSavedPrompt(saved: Prompt[], name: string): Prompt | undefined {
  const key = name.trim().toLowerCase();
  return key ? saved.find((p) => p.name.toLowerCase() === key) : undefined;
}

/**
 * A name for a prompt saved without one: its opening words, whitespace
 * flattened, cut at a word boundary near 40 characters so it does not end
 * mid-word unless one word is the whole budget.
 */
export function defaultPromptName(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "Untitled prompt";
  if (flat.length <= NAME_LIMIT) return flat;
  const cut = flat.slice(0, NAME_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > NAME_LIMIT * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
