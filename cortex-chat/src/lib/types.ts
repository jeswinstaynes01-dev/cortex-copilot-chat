/* Shared shapes. The UI only ever talks to these types, never to a transport,
   which is what makes the mock and the real backend interchangeable.

   Everything here is deliberately shaped around what the Spring Boot backend
   can actually do. If a field exists here, something on the server produces
   it — there are no placeholder concepts left in this file. */

export type Role = "user" | "assistant";

/* "failed" matters: the agent runs real tools against a real filesystem, and a
   tool that failed is not the same as a tool that finished. Collapsing the two
   would hide the most useful information on the screen. */
export type ToolStatus = "running" | "done" | "failed";

export interface ToolCall {
  id: string;
  /** Raw tool id, e.g. "str_replace_editor". Always present. */
  name: string;
  /** Human label the runtime sometimes supplies. Falls back to `name`. */
  title?: string;
  status: ToolStatus;
  /** Result text or error message once the call completes. */
  detail?: string;
}

/* The agent pauses and waits for a decision before touching anything outside
   its sandbox. The turn is BLOCKED while this is open, so it has to be
   impossible to miss in the UI. */
export interface PermissionRequest {
  id: string;
  title: string;
  detail?: string;
  /** Pretty-printed original payload, for the "details" disclosure. */
  raw?: string;
}

export type PermissionDecision = "approve" | "reject";

export interface Usage {
  currentTokens?: number;
  tokenLimit?: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  /** The agent's private thinking, when the runtime emits it. */
  reasoning: string;
  tools: ToolCall[];
  /** Permission asks raised during this reply; removed once decided. */
  permissions: PermissionRequest[];
  streaming: boolean;
  /** Set when a turn ends abnormally (aborted, errored, timed out). */
  notice?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  /** Backend session that holds this conversation's agent context, if alive. */
  sessionId?: string;
  updatedAt: number;
}

/* A single event in a streamed reply. The UI reduces a sequence of these into
   a Message, so adding a new event kind later is additive, not breaking. */
export type Delta =
  /** Append to the visible answer. */
  | { type: "text"; value: string }
  /** Replace the visible answer wholesale — the runtime's final, canonical
      copy of the message, which can differ from the concatenated deltas. */
  | { type: "text-replace"; value: string }
  | { type: "reasoning"; value: string }
  | { type: "tool"; tool: ToolCall }
  | { type: "permission"; request: PermissionRequest }
  | { type: "permission-resolved"; id: string }
  | { type: "usage"; usage: Usage }
  /** Non-fatal information worth showing inline, e.g. "Turn stopped by user." */
  | { type: "notice"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface SendOptions {
  text: string;
  history: Message[];
}

/* One of the Copilot runtime's own slash commands (/context, /review, /plan,
   skills…), as the backend lists them. Cortex's native commands win any name
   clash; the backend has already dropped the ones Cortex replaces. */
export interface RuntimeCommand {
  name: string;
  aliases: string[];
  description: string;
  /** What the input looks like, e.g. "<interval> <prompt>"; null when it takes none. */
  hint: string | null;
  required: boolean;
  choices: Array<{ name: string; description: string | null }>;
  /** "builtin" or "skill". */
  kind: string;
  /** Safe to run while a reply is streaming. */
  allowDuringTurn: boolean;
  /** Asks the user before running: it hands the agent more autonomy. */
  confirm: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  /* The reasoning efforts this specific model accepts, straight from the
     runtime. NOT a fixed scale — it varies sharply and is not guessable:
     `auto` and `claude-haiku-4.5` accept none at all, `grok-4.5` stops at
     "high", and only the Opus and GPT-6 families reach "max". The UI offers
     exactly this list and hides the control when it is empty, which is the
     only way to avoid presenting a choice the backend would discard. */
  reasoningEfforts: string[];
  /* What the model would pick if we said nothing. The runtime currently
     reports null for every model, so nothing is marked as "the default" —
     inventing one would be a guess dressed up as information. */
  defaultReasoningEffort: string | null;
  /* Premium-request multiplier. Also null for every model at present, so no
     cost estimate is shown anywhere. Kept because a null is a truthful
     "unknown", and the day the runtime fills it in the UI can use it. */
  multiplier: number | null;
  /* Who serves the model. Null is GitHub Copilot itself. Anything else
     ("openai", "azure", "anthropic") is the user's own key or endpoint — BYOK,
     e.g. a local Ollama model behind an OpenAI-compatible URL. Those requests
     are not billed to Copilot, so the quota gauge must not claim them, and
     they accept no reasoning effort. */
  provider: string | null;
}

/* A system-prompt preset the backend appends when a session is created. Only
   the id and the human copy cross the wire — the prompt text stays on the
   server, so the UI cannot drift from what the agent is actually told. */
export interface Persona {
  id: string;
  name: string;
  description: string;
}

/* An MCP server every new session is given. Read-only in the UI: servers are
   configured in the backend's application.yml, and editing them here would
   imply a control the server does not offer. `target` is the command line for
   a stdio server and the URL for an http one. */
export interface McpServer {
  name: string;
  type: "stdio" | "http";
  target: string;
  /** Tool names the session may call; ["*"] means all of them. */
  tools: string[];
}

/* A conversation the Copilot CLI recorded on disk, in its own session store.
   These are READ-ONLY: the agent process that produced them is long gone, so
   they can be browsed but never continued. That distinction is the whole
   reason they are a separate type from `Conversation`. */
export interface ArchivedSession {
  id: string;
  title: string;
  workingDirectory?: string;
  repository?: string;
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Number of user/assistant exchanges, for the "12 turns" hint. */
  turns: number;
}

export interface ArchivedTurn {
  index: number;
  user?: string;
  assistant?: string;
  timestamp?: string;
}

/* Month-to-date premium-request spend, from one of two places — and the UI
   has to say which, because they are not equally true.

   "account" is the live quota from the user's GitHub Copilot account. It is
   authoritative: `used` and `budget` are the account's used and entitled
   premium requests, and `resetDate` is when the allowance refills.

   "estimate" is the fallback when the account cannot be asked. It is summed
   from the CLI's own local usage ledger and compared against a budget set in
   the backend's config, so it misses anything spent on another machine and
   the "budget" is only as right as whoever configured it.

   Either way `used` and `budget` are in PREMIUM REQUEST units, not tokens and
   not requests: GitHub charges each request its model's multiplier, so one
   Opus call at max effort costs 15 while a small model costs 1. */
export interface Budget {
  month: string;
  used: number;
  budget: number;
  /** Where `used`/`budget` came from. Older backends omit it: "estimate". */
  source: "account" | "estimate";
  /** ISO-8601 instant the allowance resets. Only the account knows it. */
  resetDate: string | null;
  /** Plans without a premium-request cap. There is no bar to draw then. */
  unlimited: boolean;
  /** The account's own remaining share, 0–100, when it reports one. */
  remainingPercent: number | null;
  requests: number;
  sessions: number;
  /** Raw input+output tokens for the month. Shown as a secondary figure. */
  tokens: number;
  /** Model of the most recent request anywhere. */
  model: string | null;
  /** Reasoning effort of that request: "low" | "medium" | "max" | null. */
  effort: string | null;
  models: Array<{ model: string; effort: string | null; used: number; requests: number }>;
  /** False when the store could not be read; the UI then shows nothing. */
  available: boolean;
}

export interface ClientSettings {
  model: string;
  /** When true the backend approves every tool call without asking. */
  autoApprove: boolean;
  /** Absolute path the agent reads and writes. */
  workingDirectory: string;
  /* How hard the model is asked to think. Null means "the model decides" —
     which is a real, distinct choice, not a missing value.

     Fixed when the session is created, so changing it drops the session and
     makes a new one, exactly like `model`. And because the backend silently
     drops an effort the model cannot honour, this field always holds what the
     session ACTUALLY has, read back from the server — never what was asked
     for. */
  reasoningEffort: string | null;
  /* Persona id appended to the system prompt, or null for none. Same rules as
     effort: fixed at session creation, an unknown id is dropped by the server
     rather than rejected, and this holds the value the server applied. */
  persona: string | null;
}

/* Connection state drives the status chip. "connecting" is distinct from
   "offline" because a cold Spring Boot session takes a few seconds to come up
   and showing "offline" during that window reads as a failure when it isn't. */
export type ConnectionStatus = "idle" | "connecting" | "online" | "offline";

export interface ClientState {
  status: ConnectionStatus;
  /** Model display name for the pill. */
  label: string;
  settings: ClientSettings | null;
  usage: Usage | null;
  /** The live backend session, so a conversation can be re-attached later. */
  sessionId: string | null;
  /** Populated when the last operation failed, for the status chip tooltip. */
  error: string | null;
}

export interface ChatClient {
  /** Current snapshot. Cheap; safe to call during render. */
  getState(): ClientState;
  /** Subscribes to state changes. Returns an unsubscribe function. */
  subscribe(cb: (s: ClientState) => void): () => void;
  /** Models the signed-in account can use, plus any BYOK models. */
  models(): Promise<ModelOption[]>;
  /** Personas the backend can apply to a new session. */
  personas(): Promise<Persona[]>;
  /** MCP servers every session is given. Often empty. */
  mcpServers(): Promise<McpServer[]>;
  /** Conversations the CLI recorded on disk. Read-only; newest first. */
  archive(): Promise<ArchivedSession[]>;
  /** The turns of one archived conversation. */
  archiveTurns(id: string): Promise<ArchivedTurn[]>;
  /** Month-to-date spend against the plan's allowance. */
  budget(): Promise<Budget | null>;
  /** Applies settings. Starts a fresh backend session, because model, effort,
      persona, working directory and auto-approve are all fixed at session
      creation. */
  configure(patch: Partial<ClientSettings>): Promise<void>;
  /**
   * Asks the server whether a path is a usable working directory, and what it
   * resolves to. Needed because settings are fixed when the session is
   * created: without a check up front, a typo is accepted silently and only
   * fails on the next message, by which point the message has been typed and
   * lost. `resolved` is the absolute path, so `..` can be shown back as what
   * it actually means.
   */
  checkDirectory(path: string): Promise<{ ok: boolean; resolved: string | null; error: string | null }>;
  /** Abandons the current backend session and starts a new one. */
  reset(): Promise<void>;
  /**
   * Re-attaches to a session from an earlier conversation. Returns false when
   * the server no longer has it — backend sessions are in-memory and do not
   * survive a restart, while this app's transcripts do.
   */
  resume(sessionId: string): Promise<boolean>;
  /** Answers a pending permission request. */
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  /** The runtime's own slash commands for the current (or a new) session. */
  commands(): Promise<RuntimeCommand[]>;
  /**
   * Called when the runtime starts a turn by itself — a prompt scheduled with
   * /every or /after firing. Return the handler for that reply's deltas, or
   * null to leave it unshown; `cancel` stops it like the Stop button.
   */
  onExternalTurn(
    cb: ((prompt: string, cancel: () => void) => ((d: Delta) => void) | null) | null,
  ): void;
  /**
   * Starts a reply. Calls `onDelta` repeatedly until it emits `done` or
   * `error`. Returns a function that cancels the reply early. Text naming a
   * runtime command ("/context", "/every 5m check the build") runs that
   * command instead of being sent to the agent as a message.
   */
  send(opts: SendOptions, onDelta: (d: Delta) => void): () => void;
  /** Releases the SSE connection and any server-side session. */
  dispose(): void;
}
