import { useEffect, useReducer, useRef, useState } from "react";
import { eventStreamUrl } from "./api";
import type {
  ChatItem,
  CopilotEvent,
  LoggedEvent,
  PermissionPrompt,
  ToolItem,
  UsageInfo,
} from "./types";

interface StreamState {
  items: ChatItem[];
  permissions: PermissionPrompt[];
  busy: boolean;
  usage: UsageInfo | null;
  events: LoggedEvent[];
}

const EMPTY: StreamState = {
  items: [],
  permissions: [],
  busy: false,
  usage: null,
  events: [],
};

/** How many raw events the inspector keeps before dropping the oldest. */
const LOG_LIMIT = 400;

let counter = 0;
const uid = () => `local-${Date.now()}-${counter++}`;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

/** Marks any in-progress assistant bubble as finished so the next delta starts a new one. */
function settle(items: ChatItem[]): ChatItem[] {
  if (!items.some((item) => item.kind === "assistant" && item.streaming)) return items;
  return items.map((item) =>
    item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item,
  );
}

function appendDelta(items: ChatItem[], delta: string): ChatItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === "assistant" && last.streaming) {
    return [...items.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...items, { kind: "assistant", id: uid(), text: delta, streaming: true }];
}

function finalizeAssistant(items: ChatItem[], content: string): ChatItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === "assistant" && last.streaming) {
    return [...items.slice(0, -1), { ...last, text: content || last.text, streaming: false }];
  }
  if (!content) return items;
  return [...items, { kind: "assistant", id: uid(), text: content, streaming: false }];
}

function describeToolResult(data: Record<string, unknown>): string | undefined {
  const error = data.error as Record<string, unknown> | undefined;
  if (error) return String(error.message ?? JSON.stringify(error));

  const result = data.result as Record<string, unknown> | string | undefined;
  if (result == null) return undefined;
  if (typeof result === "string") return result;
  for (const key of ["content", "text", "output", "message"]) {
    const value = result[key];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(result);
}

function fold(state: StreamState, event: CopilotEvent): StreamState {
  const data = event.data ?? {};

  switch (event.type) {
    case "dashboard.ready":
      return { ...state, busy: Boolean(event.busy) };

    case "dashboard.user_message":
      return {
        ...state,
        items: [...settle(state.items), { kind: "user", id: uid(), text: event.content ?? "" }],
      };

    case "dashboard.turn_start":
      return { ...state, busy: true };

    case "dashboard.turn_end":
      return { ...state, busy: false, items: settle(state.items) };

    case "dashboard.aborted":
      return {
        ...state,
        busy: false,
        items: [
          ...settle(state.items),
          { kind: "notice", id: uid(), message: event.message ?? "Turn stopped." },
        ],
      };

    case "dashboard.error":
      return {
        ...state,
        items: [
          ...settle(state.items),
          { kind: "error", id: uid(), message: event.message ?? "Unknown error" },
        ],
      };

    case "dashboard.permission_requested": {
      if (!event.requestId) return state;
      const requestId = event.requestId;
      return {
        ...state,
        permissions: [
          ...state.permissions.filter((p) => p.requestId !== requestId),
          { requestId, request: event.request ?? {} },
        ],
      };
    }

    case "dashboard.permission_resolved":
      return {
        ...state,
        permissions: state.permissions.filter((p) => p.requestId !== event.requestId),
      };

    case "assistant.message_delta": {
      const delta = data.deltaContent;
      if (typeof delta !== "string" || delta.length === 0) return state;
      return { ...state, items: appendDelta(state.items, delta) };
    }

    case "assistant.message":
      return {
        ...state,
        items: finalizeAssistant(state.items, typeof data.content === "string" ? data.content : ""),
      };

    case "tool.execution_start": {
      const id = String(data.toolCallId ?? uid());
      const tool: ToolItem = {
        kind: "tool",
        id,
        toolName: String(data.toolName ?? "tool"),
        toolTitle: typeof data.toolTitle === "string" ? data.toolTitle : undefined,
        args: data.arguments,
        status: "running",
      };
      return { ...state, items: [...settle(state.items), tool] };
    }

    case "tool.execution_complete": {
      const id = String(data.toolCallId ?? "");
      const ok = data.success !== false && data.error == null;
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "tool" && item.id === id
            ? { ...item, status: ok ? "done" : "failed", result: describeToolResult(data) }
            : item,
        ),
      };
    }

    case "session.idle":
      return { ...state, busy: false, items: settle(state.items) };

    case "session.usage_info":
    case "assistant.usage":
      return {
        ...state,
        usage: {
          currentTokens: asNumber(data.currentTokens) ?? state.usage?.currentTokens,
          tokenLimit: asNumber(data.tokenLimit) ?? state.usage?.tokenLimit,
          messagesLength: asNumber(data.messagesLength) ?? state.usage?.messagesLength,
        },
      };

    default:
      return state;
  }
}

let logSeq = 0;

/**
 * Wraps {@link fold} so that *every* frame — including ones no view cares about —
 * lands in the inspector's event log, while the chat-shaped state is folded as before.
 */
function reducer(state: StreamState, event: CopilotEvent): StreamState {
  if (event.type === "dashboard.reset") return { ...EMPTY, events: [] };

  const next = fold(state, event);

  const { type, timestamp, data, ...envelope } = event;
  const entry: LoggedEvent = {
    seq: logSeq++,
    type,
    timestamp: timestamp || Date.now(),
    // dashboard.* events carry their fields on the envelope; runtime events use `data`.
    payload: data ?? (Object.keys(envelope).length > 0 ? envelope : undefined),
  };

  const events =
    next.events.length >= LOG_LIMIT
      ? [...next.events.slice(next.events.length - LOG_LIMIT + 1), entry]
      : [...next.events, entry];

  return { ...next, events };
}

/**
 * Opens an SSE connection for the given session and folds the event stream into chat state.
 * The backend replays buffered events on connect, so a page refresh restores the conversation.
 */
export function useSessionStream(sessionId: string | null) {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    dispatch({ type: "dashboard.reset", timestamp: Date.now() });
    setConnected(false);

    if (!sessionId) return;

    const source = new EventSource(eventStreamUrl(sessionId));
    sourceRef.current = source;

    source.addEventListener("copilot", (raw) => {
      try {
        dispatch(JSON.parse((raw as MessageEvent).data) as CopilotEvent);
      } catch {
        // Ignore malformed frames rather than tearing down the stream.
      }
    });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [sessionId]);

  return { ...state, connected };
}
