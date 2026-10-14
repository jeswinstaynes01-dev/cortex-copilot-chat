import type {
  ArchivedSession,
  ArchivedTurn,
  Budget,
  ChatClient,
  ClientSettings,
  ClientState,
  Delta,
  McpServer,
  ModelOption,
  PermissionDecision,
  PermissionRequest,
  Persona,
  RuntimeCommand,
  SendOptions,
  ToolCall,
  ToolStatus,
} from "./types";
import {
  EXTRA_COMMANDS,
  formatAgents,
  formatHelp,
  formatInstructions,
  formatRewindPoints,
  formatSchedules,
  formatTasks,
  formatVersion,
} from "./extras";

/* ---------------------------------------------------------------------------
   Talks to the Spring Boot backend in ../copilot-dashboard.

   The server is session-oriented and the stream is session-wide, but this app's
   contract is turn-oriented (`send` returns a per-reply cancel function). The
   bridging work all happens here:

     POST   /api/sessions                      create (model, cwd, autoApprove,
                                               reasoningEffort, persona)
     GET    /api/sessions/{id}/events          SSE, every frame named "copilot"
     POST   /api/sessions/{id}/messages        { prompt }            -> 202
     POST   /api/sessions/{id}/abort           stop the running turn -> 204
     POST   /api/sessions/{id}/permissions/{r} { decision, feedback }-> 204
     DELETE /api/sessions/{id}                 tear down             -> 204
     GET    /api/config                        models (incl. BYOK), personas,
                                               MCP servers, defaults
     GET    /api/history                       past CLI conversations
     GET    /api/history/{id}                  one conversation's turns
     GET    /api/usage                         premium-request quota: the
                                               account's, or a local estimate

   Every URL is relative, so the same build works behind the Vite proxy and
   when Spring Boot serves it from its own origin.
--------------------------------------------------------------------------- */

const DEFAULT_BASE = "/api";

/* Sessions are created lazily — the first message pays for it, not page load.
   Creating a Copilot session spawns real CLI work on the server, so doing it
   on mount would burn one per refresh. */
const CREATE_TIMEOUT_MS = 120_000;

interface Envelope {
  type: string;
  timestamp?: number;
  data?: Record<string, unknown>;
  /* dashboard.* events put their fields on the envelope, not in `data`. */
  busy?: boolean;
  content?: string;
  message?: string;
  requestId?: string;
  request?: Record<string, unknown>;
  /* dashboard.command_result, dashboard.plan_review_*, external turns. */
  external?: boolean;
  turnId?: string;
  kind?: string;
  text?: string;
  markdown?: boolean;
  title?: string;
  command?: unknown;
  options?: unknown;
  error?: string;
  url?: string;
  notice?: string;
  reviewId?: string;
  summary?: string;
  planContent?: string;
  actions?: unknown;
  recommendedAction?: string;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/* /api/config and /api/usage grew fields while this UI was already in use, and
   an older backend simply omits them. Every entry is read defensively, so a
   missing field degrades to "none" instead of an undefined deep in a render. */
const listOf = <T>(v: unknown, parse: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : [];

function parseModel(v: unknown): ModelOption | null {
  const m = rec(v);
  const id = str(m.id);
  if (!id) return null;
  return {
    id,
    name: str(m.name) ?? id,
    reasoningEfforts: strList(m.reasoningEfforts),
    defaultReasoningEffort: str(m.defaultReasoningEffort) ?? null,
    multiplier: num(m.multiplier) ?? null,
    provider: str(m.provider) || null,
  };
}

function parsePersona(v: unknown): Persona | null {
  const p = rec(v);
  const id = str(p.id);
  return id ? { id, name: str(p.name) ?? id, description: str(p.description) ?? "" } : null;
}

function parseMcpServer(v: unknown): McpServer | null {
  const s = rec(v);
  const name = str(s.name);
  if (!name) return null;
  return {
    name,
    type: s.type === "http" ? "http" : "stdio",
    target: str(s.target) ?? "",
    tools: strList(s.tools),
  };
}

/* What an older backend served WAS the local estimate, so a missing `source`
   means "estimate" — never "account", which would promote a guess to fact. */
function parseBudget(v: unknown): Budget | null {
  const b = rec(v);
  if (b.available !== true) return null;
  return {
    ...(b as unknown as Budget),
    source: b.source === "account" ? "account" : "estimate",
    resetDate: str(b.resetDate) ?? null,
    unlimited: b.unlimited === true,
    remainingPercent: num(b.remainingPercent) ?? null,
  };
}

/* The runtime is not consistent about which field carries streamed text, so
   probe the known spellings instead of betting on one. */
function pickText(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

/**
 * Turns the SDK's permission payload into something a person can act on.
 * Observed shape is `{ kind, toolCallId, extensionData }`, where extensionData
 * varies by kind: shell asks carry fullCommandText/shellType/intention, file
 * and network asks carry possiblePaths/possibleUrls.
 */
function summarizePermission(id: string, request: Record<string, unknown>): PermissionRequest {
  const kind = str(request.kind) ?? "action";
  const ext = rec(request.extensionData);

  const command = str(ext.fullCommandText) ?? "";
  const shellType = str(ext.shellType);
  const intention = str(ext.intention);
  const paths = strList(ext.possiblePaths);
  const urls = strList(ext.possibleUrls);

  const body = command || paths.join("\n") || urls.join("\n");

  const notes: string[] = [];
  const writes = Array.isArray(ext.commands)
    ? ext.commands.filter((entry) => rec(entry).readOnly === false).length
    : 0;
  if (writes > 0) notes.push(`${writes} command${writes > 1 ? "s" : ""} may modify state`);
  if (ext.hasWriteFileRedirection === true) notes.push("redirects output to a file");
  if (urls.length > 0) notes.push("accesses the network");

  const detail = [intention, body, notes.length ? notes.join(" · ") : ""]
    .filter(Boolean)
    .join("\n\n");

  return {
    id,
    title: shellType ? `${kind} · ${shellType}` : kind,
    detail: detail || undefined,
    raw: JSON.stringify(request, null, 2),
  };
}

function parseRuntimeCommand(v: unknown): RuntimeCommand | null {
  const c = rec(v);
  const name = str(c.name)?.replace(/^\//, "");
  if (!name) return null;
  return {
    name,
    aliases: strList(c.aliases).map((a) => a.replace(/^\//, "")),
    description: str(c.description) ?? "",
    hint: str(c.hint) || null,
    required: c.required === true,
    choices: listOf(c.choices, (x) => {
      const o = rec(x);
      const n = str(o.name);
      return n ? { name: n, description: str(o.description) ?? null } : null;
    }),
    kind: str(c.kind) ?? "builtin",
    allowDuringTurn: c.allowDuringTurn === true,
    confirm: c.confirm === true,
  };
}

/** What a runtime command's result adds to its reply bubble. */
export function describeCommandResult(e: Envelope): {
  text?: string;
  notice?: string;
  error?: string;
} {
  const name = str(e.command) ?? "command";
  switch (e.kind) {
    case "text": {
      const body = e.text ?? "";
      if (!body.trim()) return { notice: `/${name} had nothing to show.` };
      return { text: e.markdown ? body : "````text\n" + body + "\n````" };
    }
    case "completed":
    case "info":
      return { text: e.message || "Done." };
    case "select": {
      const rows = listOf(e.options, (o) => {
        const opt = rec(o);
        const option = str(opt.name);
        if (!option) return null;
        const about = str(opt.description);
        return `- \`/${name} ${option}\`${about ? ` — ${about}` : ""}`;
      });
      return { text: [e.title || `Choose one for /${name}:`, "", ...rows].join("\n") };
    }
    case "turn":
      return e.notice ? { notice: e.notice } : {};
    case "error":
      return { error: [e.error || `/${name} failed.`, e.url].filter(Boolean).join(" — ") };
    default:
      return {};
  }
}

const statusOf = (err: unknown): number | undefined => (err as { status?: number }).status;

const newRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function describeToolResult(data: Record<string, unknown>): string | undefined {
  const error = data.error;
  if (error != null) {
    const asText = str(rec(error).message) ?? (typeof error === "string" ? error : undefined);
    return asText ?? JSON.stringify(error);
  }
  const result = data.result;
  if (result == null) return undefined;
  if (typeof result === "string") return result;
  const obj = rec(result);
  for (const key of ["content", "text", "output", "message"]) {
    const value = str(obj[key]);
    if (value) return value;
  }
  return JSON.stringify(result);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      /* No JSON body — the status line is the best description available. */
    }
    throw Object.assign(new Error(detail), { status: response.status });
  }
  /* Several endpoints answer 202/204 with no body at all. Calling .json() on an
     empty body throws "Unexpected end of JSON input", which would surface as a
     spurious error after every successful send. Read text, parse only if any. */
  const text = await response.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

interface Turn {
  onDelta: (d: Delta) => void;
  /** Everything the assistant has said this turn. */
  buf: string;
  /** Index in `buf` where the current assistant message began. */
  segStart: number;
  reasoning: string;
  settled: boolean;
  /** Set when this turn is a runtime command; its events carry the same id. */
  requestId?: string;
  /** Set when the runtime started this turn itself (a scheduled prompt). */
  externalId?: string;
}

/* How far before the stream opened a scheduled turn may have started and
   still be shown. Older ones arrive only in the reconnect replay. */
const REPLAY_SLACK_MS = 5_000;

export function createCopilotClient(options: { baseUrl?: string } = {}): ChatClient {
  const base = options.baseUrl ?? DEFAULT_BASE;
  const sessionsUrl = `${base}/sessions`;

  let sessionId: string | null = null;
  let source: EventSource | null = null;
  let turn: Turn | null = null;
  let creating: Promise<string> | null = null;
  let modelCache: ModelOption[] | null = null;
  let personaCache: Persona[] | null = null;
  let mcpCache: McpServer[] | null = null;
  let commandCache: { session: string | null; list: RuntimeCommand[] } | null = null;
  /* Plan reviews ride on the permission card; this remembers what "approve"
     should pick for each one. */
  const planActions = new Map<string, string | null>();
  type ExternalHandler = (prompt: string, cancel: () => void) => ((d: Delta) => void) | null;
  let externalHandler: ExternalHandler | null = null;
  const seenExternal = new Set<string>();
  let streamOpenedAt = 0;
  let configLoad: Promise<ClientSettings> | null = null;
  let disposed = false;

  let state: ClientState = {
    status: "idle",
    label: "Copilot",
    settings: null,
    usage: null,
    sessionId: null,
    error: null,
  };

  const listeners = new Set<(s: ClientState) => void>();

  const set = (patch: Partial<ClientState>) => {
    state = { ...state, ...patch };
    listeners.forEach((cb) => cb(state));
  };

  const emit = (d: Delta) => turn?.onDelta(d);

  /* Ends the turn exactly once. The backend can legitimately signal completion
     more than one way for a single turn (session.idle AND dashboard.turn_end),
     and firing `done` twice would re-enable the composer mid-reply. */
  const finish = (d: Delta) => {
    if (!turn || turn.settled) return;
    turn.settled = true;
    const active = turn;
    turn = null;
    active.onDelta(d);
  };

  // ------------------------------------------------------------------ config

  /* The client loads config on construction, and the app asks for models and
     personas on mount — all in the same tick. Sharing the one request in
     flight keeps that to a single GET instead of three. */
  function loadConfig(): Promise<ClientSettings> {
    configLoad ??= fetchConfig().finally(() => {
      configLoad = null;
    });
    return configLoad;
  }

  async function fetchConfig(): Promise<ClientSettings> {
    const cfg = rec(await request<unknown>(`${base}/config`));

    modelCache = listOf(cfg.models, parseModel);
    personaCache = listOf(cfg.personas, parsePersona);
    mcpCache = listOf(cfg.mcpServers, parseMcpServer);
    /* A default persona the server does not list would put a badge on the
       status card for something no session will ever apply. */
    const defaultPersona = str(cfg.defaultPersona) ?? null;
    const settings: ClientSettings = state.settings ?? {
      model: str(cfg.defaultModel) ?? "auto",
      autoApprove: false,
      workingDirectory: str(cfg.defaultWorkingDirectory) ?? "",
      reasoningEffort: null,
      persona: personaCache.some((p) => p.id === defaultPersona) ? defaultPersona : null,
    };
    set({ settings, label: labelFor(settings.model), error: null });
    return settings;
  }

  function labelFor(id: string): string {
    const hit = modelCache?.find((m) => m.id === id);
    return hit?.name ?? id ?? "Copilot";
  }

  /* The efforts a model will actually accept. Empty for `auto` (the runtime
     picks the model later, so nothing can be promised about it) and for models
     with no reasoning support at all. */
  function effortsFor(modelId: string): string[] {
    return modelCache?.find((m) => m.id === modelId)?.reasoningEfforts ?? [];
  }

  // ------------------------------------------------------------------ stream

  function openStream(id: string) {
    closeStream();
    const es = new EventSource(`${sessionsUrl}/${id}/events`);
    source = es;
    streamOpenedAt = Date.now();

    es.addEventListener("copilot", (raw) => {
      try {
        handle(JSON.parse((raw as MessageEvent).data) as Envelope);
      } catch {
        /* Drop a malformed frame rather than tearing down the whole stream. */
      }
    });

    es.onopen = () => set({ status: "online", error: null });
    es.onerror = () => {
      /* EventSource reconnects on its own; "offline" is a display state, not a
         terminal one. Do not close it here or the retry never happens. */
      if (!disposed) set({ status: "offline" });
    };
  }

  function closeStream() {
    source?.close();
    source = null;
  }

  function handle(event: Envelope) {
    const data = event.data ?? {};

    switch (event.type) {
      /* The server replays its buffer to every new subscriber. On a reconnect
         mid-turn that would append the whole reply a second time. Rewinding the
         turn here makes the replay rebuild it instead of duplicating it — the
         reason `buf` is owned by this client and not by the reducer.
         Caveat: if the turn is longer than the server's event-history limit the
         rebuilt text loses its head. Losing the head beats showing it twice. */
      case "dashboard.connected":
        if (turn) {
          turn.buf = "";
          turn.segStart = 0;
          turn.reasoning = "";
          emit({ type: "text-replace", value: "" });
        }
        return;

      case "dashboard.ready":
        set({ status: "online" });
        return;

      /* Echo of our own prompt. The UI rendered it optimistically before the
         round trip, so re-adding it would show the question twice. */
      case "dashboard.user_message":
        return;

      /* Our own turns were rendered before the round trip. A turn the runtime
         started by itself — a prompt scheduled with /every or /after — has
         nothing on screen yet, so it is handed to the UI to show. The replay
         on (re)connect repeats old ones: each is shown once, and only if it
         began after this page started listening. */
      case "dashboard.turn_start": {
        const turnId = str(event.turnId);
        if (!event.external || !turnId || seenExternal.has(turnId)) return;
        seenExternal.add(turnId);
        if (turn || !externalHandler) return;
        if ((event.timestamp ?? Date.now()) < streamOpenedAt - REPLAY_SLACK_MS) return;
        const own: Turn = { onDelta: () => undefined, buf: "", segStart: 0, reasoning: "", settled: false, externalId: turnId };
        const cancel = () => {
          if (turn === own) {
            own.settled = true;
            turn = null;
          }
          if (sessionId) {
            void request<void>(`${sessionsUrl}/${sessionId}/abort`, { method: "POST" }).catch(
              () => undefined,
            );
          }
        };
        const onDelta = externalHandler(str(event.content) || "Scheduled prompt", cancel);
        if (!onDelta) return;
        own.onDelta = onDelta;
        turn = own;
        emit({ type: "notice", message: "Started by a scheduled prompt." });
        return;
      }

      /* A command's turn ends only on the turn_end carrying its own request
         id, a scheduled turn only on its own turn id. A chat turn ignores
         both kinds. */
      case "dashboard.turn_end":
        if (event.external) {
          if (turn?.externalId && turn.externalId === str(event.turnId)) finish({ type: "done" });
          return;
        }
        if ((event.requestId ?? null) !== (turn?.requestId ?? null)) return;
        finish({ type: "done" });
        return;

      /* The agent going idle says nothing about a command, which can run
         beside a reply or outlive the prompt it expanded into. */
      case "session.idle":
        if (turn?.requestId) return;
        finish({ type: "done" });
        return;

      case "dashboard.command_result": {
        if (!turn?.requestId || event.requestId !== turn.requestId) return;
        const reply = describeCommandResult(event);
        if (reply.error) {
          finish({ type: "error", message: reply.error });
          return;
        }
        if (reply.notice) emit({ type: "notice", message: reply.notice });
        if (reply.text) {
          turn.buf += reply.text;
          turn.segStart = turn.buf.length;
          emit({ type: "text", value: reply.text });
        }
        return;
      }

      case "dashboard.plan_review_requested": {
        const reviewId = str(event.reviewId);
        if (!reviewId) return;
        const actions = strList(event.actions);
        planActions.set(reviewId, str(event.recommendedAction) ?? actions[0] ?? null);
        emit({
          type: "permission",
          request: {
            id: `plan:${reviewId}`,
            title: "Plan ready for review",
            detail: [event.summary, event.planContent].filter(Boolean).join("\n\n") || undefined,
            raw: JSON.stringify(
              { actions, recommendedAction: event.recommendedAction ?? null },
              null,
              2,
            ),
          },
        });
        return;
      }

      case "dashboard.plan_review_resolved":
        if (event.reviewId) {
          planActions.delete(event.reviewId);
          emit({ type: "permission-resolved", id: `plan:${event.reviewId}` });
        }
        return;

      case "dashboard.aborted":
        emit({ type: "notice", message: event.message ?? "Turn stopped." });
        finish({ type: "done" });
        return;

      case "dashboard.error":
      case "session.error":
        if (event.requestId && event.requestId !== turn?.requestId) return;
        finish({ type: "error", message: event.message ?? str(data.message) ?? "Unknown error" });
        return;

      case "dashboard.permission_requested": {
        if (!event.requestId) return;
        emit({
          type: "permission",
          request: summarizePermission(event.requestId, event.request ?? {}),
        });
        return;
      }

      case "dashboard.permission_resolved":
        if (event.requestId) emit({ type: "permission-resolved", id: event.requestId });
        return;

      case "assistant.message_delta": {
        const value = pickText(data, ["deltaContent", "delta", "content", "text"]);
        if (!value || !turn) return;
        turn.buf += value;
        emit({ type: "text", value });
        return;
      }

      /* The runtime's final, canonical copy of the message. It can differ from
         the concatenation of the deltas (trailing whitespace, late edits), so
         reconcile rather than append — but only when it actually differs, or
         every reply would re-render itself for nothing. */
      case "assistant.message": {
        const content = pickText(data, ["content", "text"]);
        if (!turn || !content) return;
        const segment = turn.buf.slice(turn.segStart);
        if (segment !== content) {
          turn.buf = turn.buf.slice(0, turn.segStart) + content;
          emit({ type: "text-replace", value: turn.buf });
        }
        turn.segStart = turn.buf.length;
        return;
      }

      case "assistant.reasoning_delta":
      case "assistant.reasoning": {
        const value = pickText(data, ["deltaContent", "delta", "content", "text", "reasoning"]);
        if (!value || !turn) return;
        /* A non-delta reasoning event is the whole block; appending it after the
           deltas that built it would double the text. */
        if (event.type === "assistant.reasoning" && turn.reasoning.endsWith(value)) return;
        turn.reasoning += value;
        emit({ type: "reasoning", value });
        return;
      }

      case "tool.execution_start": {
        const id = str(data.toolCallId) ?? `tool-${Date.now()}`;
        const tool: ToolCall = {
          id,
          name: str(data.toolName) ?? "tool",
          title: str(data.toolTitle),
          status: "running",
        };
        /* Anything the assistant said before this tool ran is finished text; a
           later canonical `assistant.message` must not overwrite it. */
        if (turn) turn.segStart = turn.buf.length;
        emit({ type: "tool", tool });
        return;
      }

      case "tool.execution_complete": {
        const id = str(data.toolCallId);
        if (!id) return;
        const ok = data.success !== false && data.error == null;
        const status: ToolStatus = ok ? "done" : "failed";
        emit({
          type: "tool",
          tool: { id, name: str(data.toolName) ?? "tool", status, detail: describeToolResult(data) },
        });
        return;
      }

      case "session.usage_info":
      case "assistant.usage": {
        const usage = {
          currentTokens: num(data.currentTokens) ?? state.usage?.currentTokens,
          tokenLimit: num(data.tokenLimit) ?? state.usage?.tokenLimit,
        };
        set({ usage });
        emit({ type: "usage", usage });
        return;
      }

      default:
        return;
    }
  }

  // ----------------------------------------------------------------- session

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    /* Two quick sends must not race into two sessions. */
    if (creating) return creating;

    creating = (async () => {
      set({ status: "connecting", error: null });
      const settings = state.settings ?? (await loadConfig());

      const timer = AbortSignal.timeout?.(CREATE_TIMEOUT_MS);
      const created = await request<{
        id: string;
        reasoningEffort: string | null;
        persona?: string | null;
      }>(sessionsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          workingDirectory: settings.workingDirectory || undefined,
          autoApprove: settings.autoApprove,
          reasoningEffort: settings.reasoningEffort ?? undefined,
          /* Never null. The server reads a missing persona as "use the
             configured default", so choosing None has to be said out loud.
             Nothing is lost by it: the starting value IS that default, read
             from /api/config, so it is always sent explicitly too. */
          persona: settings.persona ?? "none",
        }),
        signal: timer,
      });

      sessionId = created.id;
      openStream(created.id);
      /* Adopt the effort and persona the SERVER reports, not the ones we asked
         for. They differ when the model cannot honour the effort or the
         persona id is unknown, and the server drops either rather than failing
         the call. Taking the server's word is what keeps the pill and the
         status card from advertising a setting the session does not have. */
      const applied = created.reasoningEffort ?? null;
      const persona = created.persona ?? null;
      if (applied !== settings.reasoningEffort || persona !== settings.persona) {
        set({ settings: { ...settings, reasoningEffort: applied, persona } });
      }
      set({ sessionId: created.id });
      return created.id;
    })();

    try {
      return await creating;
    } catch (err) {
      set({ status: "offline", error: (err as Error).message });
      throw err;
    } finally {
      creating = null;
    }
  }

  async function dropSession() {
    const id = sessionId;
    sessionId = null;
    closeStream();
    set({ sessionId: null });
    if (!id) return;
    try {
      await request<void>(`${sessionsUrl}/${id}`, { method: "DELETE" });
    } catch {
      /* A session that cannot be deleted is the server's problem to reap; the
         client has already stopped pointing at it. */
    }
  }

  // ------------------------------------------------------------------ public

  async function loadCommands(): Promise<RuntimeCommand[]> {
    const key = sessionId;
    if (commandCache && commandCache.session === key) return commandCache.list;
    const url = key ? `${sessionsUrl}/${key}/commands` : `${base}/commands`;
    const runtime = listOf(await request<unknown>(url), parseRuntimeCommand);
    const extras = new Set(EXTRA_COMMANDS.map((c) => c.name));
    const list = [...runtime.filter((c) => !extras.has(c.name)), ...EXTRA_COMMANDS];
    commandCache = { session: key, list };
    return list;
  }

  /* The CLI commands served by Cortex's own endpoints (see extras.ts). Each
     answers with markdown for the reply bubble; a failure throws, and the
     caller shows it as the reply's error. */
  async function runExtra(id: string, name: string, input: string): Promise<string> {
    const at = `${sessionsUrl}/${id}`;
    const post = (url: string, body?: unknown) =>
      request<unknown>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const [verb = "", ...rest] = input.split(/\s+/).filter(Boolean);
    const arg = rest.join(" ").replace(/^#/, "");
    switch (name) {
      case "agent": {
        if (!input) return formatAgents(await request<unknown>(`${at}/agents`));
        const target = /^(default|none)$/i.test(input) ? null : input;
        const after = rec(await post(`${at}/agent`, { name: target }));
        return `Switched to the **${str(after.current) ?? "default"}** agent.`;
      }
      case "rewind": {
        const listing = await request<unknown>(`${at}/rewind`);
        if (!input) return formatRewindPoints(listing);
        const points = listOf(rec(listing).points, (p) => rec(p));
        const n = Number(input);
        const eventId = Number.isInteger(n) ? str(points[n - 1]?.eventId) : input;
        if (!eventId) throw new Error(`There is no rewind point ${input}. Run /rewind to list them.`);
        const done = rec(await post(`${at}/rewind`, { eventId }));
        return (
          `Rewound: the agent forgot ${num(done.eventsRemoved) ?? 0} events, from that prompt on. ` +
          "The transcript above is kept for reference."
        );
      }
      case "tasks": {
        if (verb.toLowerCase() !== "cancel" || !arg) {
          return formatTasks(await request<unknown>(`${at}/tasks`));
        }
        const r = rec(await post(`${at}/tasks/${encodeURIComponent(arg)}/cancel`));
        return r.cancelled === true ? `Cancelled task \`${arg}\`.` : `Task \`${arg}\` was not running.`;
      }
      case "schedules": {
        if (verb.toLowerCase() !== "stop" || !arg) {
          return formatSchedules(await request<unknown>(`${at}/schedules`));
        }
        if (!/^\d+$/.test(arg)) throw new Error("Give the schedule's number, e.g. /schedules stop 3.");
        await post(`${at}/schedules/${arg}/stop`);
        return `Stopped scheduled prompt #${arg}.`;
      }
      case "instructions":
        return formatInstructions(await request<unknown>(`${at}/instructions`));
      case "version":
        return formatVersion(await request<unknown>(`${base}/version`));
      default:
        return formatHelp(await loadCommands());
    }
  }

  /* The backend answers 428 for anything that hands the agent more autonomy
     (/autopilot, /fleet, /every, an autopilot plan…). Asking the user here and
     resending is the confirmation; declining sends nothing. */
  async function postConfirmed(url: string, body: Record<string, unknown>): Promise<boolean> {
    const post = (confirmed: boolean) =>
      request<void>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, confirmed }),
      });
    try {
      await post(false);
      return true;
    } catch (err) {
      if (statusOf(err) !== 428) throw err;
      if (!window.confirm((err as Error).message)) return false;
      await post(true);
      return true;
    }
  }

  void loadConfig().catch((err: Error) =>
    set({ status: "offline", error: err.message }),
  );

  return {
    getState: () => state,

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async models() {
      if (modelCache) return modelCache;
      await loadConfig();
      return modelCache ?? [];
    },

    async personas() {
      if (personaCache) return personaCache;
      await loadConfig();
      return personaCache ?? [];
    },

    async mcpServers() {
      if (mcpCache) return mcpCache;
      await loadConfig();
      return mcpCache ?? [];
    },

    /* The CLI's own archive. Read-only, and deliberately NOT merged into the
       live session list: these conversations belong to agent processes that
       exited long ago, so they can be read but never continued. */
    async archive() {
      try {
        return (await request<ArchivedSession[]>(`${base}/history?limit=60`)) ?? [];
      } catch {
        /* The archive is a nice-to-have on top of a chat app that works
           without it. A missing or locked store must not surface as an error. */
        return [];
      }
    },

    async archiveTurns(id: string) {
      try {
        return (await request<ArchivedTurn[]>(`${base}/history/${id}`)) ?? [];
      } catch {
        return [];
      }
    },

    async budget() {
      try {
        return parseBudget(await request<unknown>(`${base}/usage`));
      } catch {
        return null;
      }
    },

    /* Model, working directory, auto-approve, reasoning effort and persona are
       all fixed when the server creates the session, so changing any of them
       has to start a new one. There is no in-place update to call. */
    async configure(patch) {
      const current = state.settings ?? (await loadConfig());
      const next = { ...current, ...patch };

      /* Switching model can strand the effort: "max" is valid on Opus and
         meaningless on grok-4.5, and `auto` accepts none at all. Clear it here
         rather than letting the server drop it, so the UI never shows a stale
         badge for the gap between choosing and sending.

         Only when the caller did not set an effort in this same patch — doing
         both at once is a deliberate pairing and must be left alone. */
      if (patch.model !== undefined && patch.reasoningEffort === undefined) {
        if (next.reasoningEffort && !effortsFor(next.model).includes(next.reasoningEffort)) {
          next.reasoningEffort = null;
        }
      }

      set({ settings: next, label: labelFor(next.model) });
      await dropSession();
      set({ status: "idle", usage: null });
    },

    /* Resolution is done on the server, not here, for two reasons: the browser
       cannot see the filesystem at all, and the server is where the rule
       actually lives — it calls the very method session creation calls, so a
       path this accepts is a path that will work. A check written separately
       in the client would be a guess that drifts. */
    async checkDirectory(path) {
      try {
        return await request<{ ok: boolean; resolved: string | null; error: string | null }>(
          `${base}/config/working-directory?path=${encodeURIComponent(path)}`,
        );
      } catch (e) {
        /* The backend being unreachable is not the same as the path being
           wrong, and saying "that folder does not exist" would send the user
           hunting for a problem that is not there. */
        return { ok: false, resolved: null, error: `Could not reach the backend: ${String(e)}` };
      }
    },

    async reset() {
      await dropSession();
      set({ status: "idle", usage: null, error: null });
    },

    /* Backend sessions live in a ConcurrentHashMap and die with the process,
       while this app's transcripts live in localStorage and do not. Probing
       before adopting is what stops the UI claiming the agent still remembers
       a conversation it has actually forgotten. */
    async resume(id) {
      if (sessionId === id) return true;
      /* Asks for the LIST and looks for the id, rather than probing
         `GET /sessions/{id}` directly. Both answer the question, but the
         direct probe answers it with a 404 — which is a perfectly normal
         outcome here (sessions die with the JVM, transcripts do not) yet
         still paints a red error in the browser console and in every network
         log. Reserving 404 for genuine mistakes is worth one extra field. */
      try {
        const all = await request<Array<{ id: string }>>(sessionsUrl);
        if (!all.some((s) => s.id === id)) return false;
      } catch {
        return false;
      }
      closeStream();
      sessionId = id;
      openStream(id);
      set({ sessionId: id, status: "connecting", error: null });
      return true;
    },

    async decide(requestId, decision: PermissionDecision) {
      if (!sessionId) return;
      if (requestId.startsWith("plan:")) {
        const reviewId = requestId.slice("plan:".length);
        const approved = decision === "approve";
        await postConfirmed(`${sessionsUrl}/${sessionId}/plan-reviews/${reviewId}`, {
          approved,
          action: approved ? (planActions.get(reviewId) ?? undefined) : undefined,
          feedback: approved ? undefined : "The user declined this plan.",
        });
        return;
      }
      await request<void>(`${sessionsUrl}/${sessionId}/permissions/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          feedback: decision === "reject" ? "The user declined this action." : undefined,
        }),
      });
    },

    async commands() {
      try {
        return await loadCommands();
      } catch {
        return [];
      }
    },

    onExternalTurn(cb) {
      externalHandler = cb;
    },

    send(opts: SendOptions, onDelta) {
      turn = { onDelta, buf: "", segStart: 0, reasoning: "", settled: false };
      const mine = turn;
      let cancelled = false;
      const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(opts.text.trim());

      void (async () => {
        try {
          const id = await ensureSession();
          if (cancelled) return;
          /* "/name input" naming one of the runtime's commands runs it; any
             other text, slash or not, is a message for the agent. */
          const name = slash?.[1];
          const extra = name ? EXTRA_COMMANDS.find((c) => c.name === name) : undefined;
          if (extra) {
            const reply = await runExtra(id, extra.name, slash?.[2]?.trim() ?? "");
            if (cancelled || turn !== mine) return;
            mine.buf += reply;
            emit({ type: "text", value: reply });
            finish({ type: "done" });
            return;
          }
          const command = name
            ? (await loadCommands().catch((): RuntimeCommand[] => [])).find(
                (c) => c.name === name || c.aliases.includes(name),
              )
            : undefined;
          if (cancelled) return;
          if (command) {
            mine.requestId = newRequestId();
            const ran = await postConfirmed(`${sessionsUrl}/${id}/commands`, {
              requestId: mine.requestId,
              name: command.name,
              input: slash?.[2]?.trim() || undefined,
            });
            if (!ran && turn === mine) {
              emit({ type: "notice", message: `/${command.name} was not run.` });
              finish({ type: "done" });
            }
            return;
          }
          await request<void>(`${sessionsUrl}/${id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: opts.text }),
          });
        } catch (err) {
          if (cancelled) return;
          /* Guard against a late failure from a turn the user already replaced. */
          if (turn === mine) finish({ type: "error", message: (err as Error).message });
        }
      })();

      return () => {
        cancelled = true;
        if (turn === mine) {
          turn.settled = true;
          turn = null;
        }
        if (sessionId) {
          void request<void>(`${sessionsUrl}/${sessionId}/abort`, { method: "POST" }).catch(
            () => undefined,
          );
        }
      };
    },

    dispose() {
      disposed = true;
      turn = null;
      void dropSession();
      listeners.clear();
    },
  };
}
