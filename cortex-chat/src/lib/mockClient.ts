import type {
  ChatClient,
  ClientSettings,
  ClientState,
  Delta,
  McpServer,
  ModelOption,
  Persona,
  SendOptions,
} from "./types";

/* ==========================================================================
   MOCK CLIENT

   Streams canned replies token by token so the UI can be built and judged
   with no backend running. It implements the same `ChatClient` interface the
   real transport does — including permissions, reasoning and usage — because
   a mock that only covers the happy path lets you design screens that turn
   out to be impossible once the real events arrive.
   ========================================================================== */

const REPLIES: Array<{ match: RegExp; body: string }> = [
  {
    match: /synthesi|summar|notes/i,
    body: `Here are the five points worth keeping:

1. **Scope is agreed, timing is not.** Everyone accepted the feature list; the argument was only about which release it lands in.
2. **The migration is the long pole.** Roughly three weeks of work that nothing else can start without.
3. **Two owners are unassigned.** Billing and the notification rework both need names on them before Friday.
4. **The staging environment is the bottleneck.** Shared across three teams, and currently booked solid.
5. **Decision needed from legal** on the data-retention window before the schema is frozen.

Want me to turn these into tickets?`,
  },
  {
    match: /brainstorm|tagline|creative|name/i,
    body: `Three directions, each with a different bet:

**"Quietly Radical"** — leans on understatement. Works if the product is unglamorous but the results are not.

**"Made to Be Outgrown"** — a durability promise. Slightly risky; it invites the reader to imagine leaving.

**"Nothing Wasted"** — the safest of the three and the most literal. Pairs well with a sustainability story.

My pick is the third for a launch and the first for a brand campaign. Want me to push further on any one of them?`,
  },
  {
    match: /gdpr|ccpa|fact|differen|compare/i,
    body: `The short version:

**Who it covers.** GDPR protects anyone in the EU regardless of where the company sits. CCPA protects California residents, and only applies to businesses over certain revenue or data-volume thresholds.

**Consent model.** GDPR is opt-in — you need a lawful basis *before* processing. CCPA is opt-out — you may process until the consumer says stop.

**Right to delete.** Both grant it. GDPR's exceptions are narrower.

**Penalties.** GDPR reaches 4% of global annual turnover. CCPA is a fixed amount per violation, which scales with the number of records rather than the size of the company.

The practical consequence: building for GDPR usually satisfies CCPA, but not the reverse.`,
  },
  {
    match: /sprint|plan|schedule|roadmap/i,
    body: `Here is a seven-day shape. I have front-loaded the risky work so that a slip shows up on day three rather than day six.

**Days 1–2 — De-risk.** Spike the migration. Nothing else is scheduled against it, because if it goes badly the rest of the plan changes.
**Day 3 — Checkpoint.** Go or no-go on the migration approach.
**Days 4–5 — Build.** The two features that depend on the new schema.
**Day 6 — Integrate and test.** Including the staging slot, which needs booking now.
**Day 7 — Buffer.** Deliberately empty. If you fill it, you no longer have a plan, you have a hope.

Shall I draft the day-three checkpoint criteria?`,
  },
  /* Last, so it never steals a prompt the replies above already answer. It is
     here because nothing else the simulator says contains a fenced block, and
     code blocks are the one part of the renderer that has to cope with a
     fence that is still open mid-stream. */
  {
    match: /\bcode\b|snippet|debounce|function/i,
    body: `Here is a small, dependency-free debounce:

\`\`\`ts
/* Waits until calls stop for \`ms\` before running \`fn\` once. */
export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    // Only the last call in a burst survives.
    timer = setTimeout(() => fn(...args), ms);
  };
}

const save = debounce((text: string) => console.log("saved", text.length), 400);
\`\`\`

Every call resets the timer, so a burst of keystrokes produces one save, 400 ms after the last one. Want a version that also fires on the leading edge?`,
  },
];

const FALLBACK = `Good question. Here is how I would approach it:

First, I would get clear on what "done" looks like, because that usually settles most of the arguments about method. Then I would look for the smallest version that could be tested — not the smallest version that could ship, which is a different and much larger thing.

From there it is mostly a matter of sequencing: do the part that could invalidate the rest of the plan first, so that a bad surprise arrives early and cheap rather than late and expensive.

Tell me more about the constraints and I can get specific.`;

const REASONING = `The question is broad, so the useful move is to narrow it before answering. I will state the assumption I am making, answer against that assumption, and flag the place where a different assumption would change the answer.`;

/* Mirrors the real runtime's shape, including the fact that effort support is
   per-model and wildly uneven. The first four cover every branch the UI has:
   no support at all (auto), no support on a real model (haiku), a list with
   "max" (sonnet), and a list with "none" but no "max" (gpt-5.5). Flattening
   them to one scale would make the mock harness pass on cases live would
   fail. The last is a BYOK model — the user's own OpenAI-compatible endpoint,
   here a local Ollama — which the backend reports with efforts [] and a
   provider, and which must never be counted against the Copilot quota.

   `defaultReasoningEffort` and `multiplier` are null here because they are null
   in the real response too — the runtime does not report them. */
const MODELS: ModelOption[] = [
  {
    id: "auto",
    name: "Auto",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    multiplier: null,
    provider: null,
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: null,
    multiplier: null,
    provider: null,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
    defaultReasoningEffort: null,
    multiplier: null,
    provider: null,
  },
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    multiplier: null,
    provider: null,
  },
  {
    id: "llama3.2",
    name: "Llama 3.2 (Ollama)",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    multiplier: null,
    provider: "openai",
  },
];

/* The same three the backend ships in application.yml. Only the copy lives
   here; the prompt text itself never leaves the server. */
const PERSONAS: Persona[] = [
  {
    id: "qa-engineer",
    name: "QA Engineer",
    description: "Thinks in test cases: edge cases, negative paths and clear expected results.",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews for bugs, risk and readability, and says what to change and why.",
  },
  {
    id: "eli5-tutor",
    name: "ELI5 Tutor",
    description: "Explains it simply, with everyday analogies and no jargon.",
  },
];

const MCP_SERVERS: McpServer[] = [
  { name: "playwright", type: "stdio", target: "npx -y @playwright/mcp@latest", tools: ["*"] },
];

/* Splits on whitespace but keeps it, so the reply re-assembles with its
   original spacing and line breaks intact. The capture group in `split` is
   what makes the separators part of the result. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

function pick(text: string): string {
  return REPLIES.find((r) => r.match.test(text))?.body ?? FALLBACK;
}

export function createMockClient(): ChatClient {
  let settings: ClientSettings = {
    model: "auto",
    autoApprove: false,
    workingDirectory: "C:\\Users\\you\\workspace",
    reasoningEffort: null,
    persona: null,
  };

  let state: ClientState = {
    status: "online",
    label: "Cortex",
    settings,
    usage: { currentTokens: 1840, tokenLimit: 128_000 },
    sessionId: "mock-session",
    error: null,
  };

  const listeners = new Set<(s: ClientState) => void>();
  const set = (patch: Partial<ClientState>) => {
    state = { ...state, ...patch };
    listeners.forEach((cb) => cb(state));
  };

  /* Held so `decide()` can release a simulated permission the same way the
     real backend does — by letting the blocked turn continue. */
  let release: (() => void) | null = null;

  return {
    getState: () => state,

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async models() {
      return MODELS;
    },

    async personas() {
      return PERSONAS;
    },

    async mcpServers() {
      return MCP_SERVERS;
    },

    /* Enough archived rows to exercise the grouping, the turn-count hint and
       the read-only banner without a backend. Dates are relative so the "Today"
       and "Yesterday" buckets stay correct however long this file lives. */
    async archive() {
      const day = 86_400_000;
      const at = (d: number) => new Date(Date.now() - d).toISOString();
      return [
        {
          id: "arc-1",
          title: "Spring Boot architecture walkthrough",
          workingDirectory: "C:\\Users\\you\\IdeaProjects\\demo-api",
          repository: "you/demo-api",
          createdAt: at(day * 0.2),
          updatedAt: at(day * 0.2),
          turns: 14,
        },
        {
          id: "arc-2",
          title: "Generate Test Scenarios for the Login Story",
          workingDirectory: "C:\\Users\\you",
          createdAt: at(day * 1.4),
          updatedAt: at(day * 1.4),
          turns: 9,
        },
        {
          id: "arc-3",
          title: "Implement File Upload Feature",
          workingDirectory: "C:\\Users\\you\\workspace\\demo-web",
          repository: "you/demo-web",
          createdAt: at(day * 9),
          updatedAt: at(day * 9),
          turns: 22,
        },
      ];
    },

    async archiveTurns(id) {
      return [
        {
          index: 0,
          user: "Walk me through how the API service is laid out.",
          assistant:
            "It is a Maven multi-module build. `demo-model` holds the JPA entities, " +
            "`demo-core` the business logic, and `demo-rest` the REST layer.",
          timestamp: new Date().toISOString(),
        },
        {
          index: 1,
          user: "Which module owns the Liquibase changelogs?",
          assistant: `\`demo-core\` owns them. (archived session ${id})`,
          timestamp: new Date().toISOString(),
        },
      ];
    },

    /* Shaped like the account answer, the authoritative one, because that is
       the branch the status card spends most of its code on. The reset date is
       always the first of next month so the harness can assert it. */
    async budget() {
      const now = new Date();
      const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return {
        month: now.toISOString().slice(0, 7),
        used: 1240,
        budget: 1500,
        source: "account" as const,
        resetDate: reset.toISOString(),
        unlimited: false,
        remainingPercent: 17.3,
        requests: 818,
        sessions: 19,
        tokens: 81_832_636,
        model: "claude-sonnet-5",
        effort: "max",
        models: [
          { model: "claude-sonnet-5", effort: "max", used: 840, requests: 500 },
          { model: "gpt-5.6-luna", effort: "low", used: 400, requests: 318 },
        ],
        available: true,
      };
    },

    async configure(patch) {
      settings = { ...settings, ...patch };

      /* The same reconciliation the real client does. Duplicated deliberately:
         if the simulator were more forgiving than the server, the harness would
         pass on a combination that breaks live. */
      if (patch.model !== undefined && patch.reasoningEffort === undefined) {
        const allowed = MODELS.find((m) => m.id === settings.model)?.reasoningEfforts ?? [];
        if (settings.reasoningEffort && !allowed.includes(settings.reasoningEffort)) {
          settings = { ...settings, reasoningEffort: null };
        }
      }
      /* The server drops a persona id it does not know instead of failing the
         session, so the simulator does too. */
      if (settings.persona && !PERSONAS.some((p) => p.id === settings.persona)) {
        settings = { ...settings, persona: null };
      }

      const label = MODELS.find((m) => m.id === settings.model)?.name ?? "Cortex";
      set({ settings, label });
    },

    /* The simulator has no filesystem, so it answers from a fixed list. The
       point is not to be right about this machine — it is to give the harness
       both outcomes to exercise, since a mock that accepted everything would
       let the failure path rot untested. Paths are matched case-insensitively
       because Windows does. */
    async checkDirectory(path) {
      const trimmed = path.trim();
      if (!trimmed) return { ok: true, resolved: settings.workingDirectory, error: null };
      const known = [
        "C:\\Users\\you",
        "C:\\Users\\you\\workspace",
        "C:\\Users\\you\\workspace\\cortex-chat",
      ];
      const hit = known.find((k) => k.toLowerCase() === trimmed.replace(/[\\/]+$/, "").toLowerCase());
      return hit
        ? { ok: true, resolved: hit, error: null }
        : { ok: false, resolved: null, error: `Working directory does not exist: ${trimmed}` };
    },

    async reset() {
      set({ usage: { currentTokens: 0, tokenLimit: 128_000 }, error: null });
    },

    async resume(id) {
      return id === "mock-session";
    },

    async decide(_requestId, _decision) {
      release?.();
      release = null;
    },

    /* The demo has no runtime behind it, so only Cortex's own commands exist. */
    async commands() {
      return [];
    },

    /* Nothing is ever scheduled in the demo. */
    onExternalTurn() {},

    send({ text }: SendOptions, onDelta: (d: Delta) => void) {
      let cancelled = false;
      const timers: number[] = [];

      const at = (ms: number, fn: () => void) => {
        timers.push(window.setTimeout(() => !cancelled && fn(), ms));
      };

      /* Anything that sounds like it touches the filesystem triggers the
         permission flow, which is the one path that is easy to forget to
         design for and impossible to use the app without. */
      const needsPermission = /write|create|delete|run|install|commit|file/i.test(text);
      const tokens = tokenize(pick(text));
      const reasoning = tokenize(REASONING);

      let clock = 320;

      reasoning.forEach((tok) => {
        clock += 10 + Math.random() * 18;
        at(clock, () => onDelta({ type: "reasoning", value: tok }));
      });

      clock += 260;

      const startStream = (from: number) => {
        let c = from;
        at(c, () =>
          onDelta({
            type: "tool",
            tool: { id: "t1", name: "read_file", title: "Reading project files", status: "running" },
          }),
        );
        c += 820;
        at(c, () =>
          onDelta({
            type: "tool",
            tool: { id: "t1", name: "read_file", status: "done", detail: "6 files read" },
          }),
        );

        tokens.forEach((tok) => {
          /* Jittered so it reads like generation rather than a metronome.
             Punctuation gets a longer pause, which is most of the illusion. */
          c += /[.!?]\s*$/.test(tok) ? 110 : 14 + Math.random() * 34;
          at(c, () => onDelta({ type: "text", value: tok }));
        });

        at(c + 100, () => {
          const usage = {
            currentTokens: (state.usage?.currentTokens ?? 0) + tokens.length * 3,
            tokenLimit: 128_000,
          };
          set({ usage });
          onDelta({ type: "usage", usage });
          onDelta({ type: "done" });
        });
      };

      if (needsPermission && !settings.autoApprove) {
        at(clock, () =>
          onDelta({
            type: "permission",
            request: {
              id: "perm-1",
              title: "shell · pwsh",
              detail:
                "Create the file and write the generated content to it.\n\nnpm run build\n\n1 command may modify state",
              raw: '{\n  "kind": "shell",\n  "extensionData": {\n    "fullCommandText": "npm run build"\n  }\n}',
            },
          }),
        );
        /* The turn genuinely stalls here, exactly as the real one does, until
           `decide()` is called. That is the behaviour worth rehearsing. */
        release = () => {
          onDelta({ type: "permission-resolved", id: "perm-1" });
          startStream(60);
        };
      } else {
        startStream(clock);
      }

      return () => {
        cancelled = true;
        release = null;
        timers.forEach(clearTimeout);
      };
    },

    dispose() {
      listeners.clear();
    },
  };
}
