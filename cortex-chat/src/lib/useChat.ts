import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatClient,
  ClientState,
  Conversation,
  Delta,
  Message,
  PermissionDecision,
} from "./types";

const STORE_KEY = "cortex.chats.v2";

const uid = () => Math.random().toString(36).slice(2, 10);

function emptyMessage(role: Message["role"], text = ""): Message {
  return {
    id: uid(),
    role,
    text,
    reasoning: "",
    tools: [],
    permissions: [],
    streaming: false,
    createdAt: Date.now(),
  };
}

/* No seeded conversations. The sidebar used to ship with ten invented chat
   titles so the design looked lived-in; every one of them opened an empty
   thread. A history list that lies about what it contains is worse than an
   empty one, so it starts empty and fills up as you actually use it. */
function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    /* Corrupt or unavailable storage should never stop the app booting. */
    return [];
  }
}

export function useChat(client: ChatClient) {
  const [conversations, setConversations] = useState<Conversation[]>(load);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* True when this conversation's transcript outlived its backend session, so
     the agent no longer remembers any of it. */
  const [detached, setDetached] = useState(false);
  const [state, setState] = useState<ClientState>(() => client.getState());
  const abortRef = useRef<(() => void) | null>(null);
  /* Mirrors `activeId` for use inside the client subscription, which is not a
     React render and would otherwise close over whatever value was current
     when it was registered. Every change goes through `selectChat` so the two
     can never drift apart. */
  const activeIdRef = useRef<string | null>(null);

  const selectChat = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  useEffect(
    () =>
      client.subscribe((s) => {
        setState(s);

        /* Stamp the live backend session onto the open conversation. It has to
           happen here and not straight after `send`: creating a session is an
           HTTP round trip, so when `send` returns there is usually no id yet.
           Reacting to the client instead records it the moment it arrives, and
           re-records it after a reset or a resume. */
        const sid = s.sessionId;
        const conv = activeIdRef.current;
        if (!sid || !conv) return;
        setConversations((prev) =>
          prev.some((c) => c.id === conv && c.sessionId !== sid)
            ? prev.map((c) => (c.id === conv ? { ...c, sessionId: sid } : c))
            : prev,
        );
      }),
    [client],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(conversations.slice(0, 60)));
    } catch {
      /* Private mode, quota, disabled storage — none of it is fatal. */
    }
  }, [conversations]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const messages = active?.messages ?? [];

  /* Applies a change to one conversation's message list and floats it to the
     top of the sidebar. Written as a functional update so overlapping stream
     events can never read stale state. */
  const patch = useCallback((id: string, fn: (msgs: Message[]) => Message[]) => {
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === id ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c,
      );
      const hit = next.find((c) => c.id === id);
      return hit ? [hit, ...next.filter((c) => c.id !== id)] : next;
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setBusy(false);
    if (activeId) {
      patch(activeId, (msgs) =>
        msgs.map((m) => (m.streaming ? { ...m, streaming: false, permissions: [] } : m)),
      );
    }
  }, [activeId, patch]);

  /* The reducer for one streaming reply, shared by the replies the user asks
     for and the ones a scheduled prompt starts on its own. */
  const handlerFor = useCallback(
    (convId: string, replyId: string) => {
      /* Narrows a whole-list update down to the one streaming message. Every
         branch below is a pure transform of that message, which keeps the
         reducer readable and makes each event independently testable. */
      const onReply = (fn: (m: Message) => Message) =>
        patch(convId, (msgs) => msgs.map((m) => (m.id === replyId ? fn(m) : m)));

      const onDelta = (d: Delta) => {
        switch (d.type) {
          case "text":
            onReply((m) => ({ ...m, text: m.text + d.value }));
            return;

          case "text-replace":
            onReply((m) => ({ ...m, text: d.value }));
            return;

          case "reasoning":
            onReply((m) => ({ ...m, reasoning: m.reasoning + d.value }));
            return;

          case "tool":
            onReply((m) => {
              const known = m.tools.some((t) => t.id === d.tool.id);
              return {
                ...m,
                tools: known
                  ? /* Merge rather than replace: execution_complete carries the
                       status and result but not the title from execution_start. */
                    m.tools.map((t) => (t.id === d.tool.id ? { ...t, ...d.tool } : t))
                  : [...m.tools, d.tool],
              };
            });
            return;

          case "permission":
            onReply((m) => ({
              ...m,
              permissions: [
                ...m.permissions.filter((p) => p.id !== d.request.id),
                d.request,
              ],
            }));
            return;

          case "permission-resolved":
            onReply((m) => ({
              ...m,
              permissions: m.permissions.filter((p) => p.id !== d.id),
            }));
            return;

          case "notice":
            onReply((m) => ({ ...m, notice: d.message }));
            return;

          case "usage":
            return;

          case "error":
            onReply((m) => ({
              ...m,
              streaming: false,
              permissions: [],
              notice: d.message,
            }));
            abortRef.current = null;
            setBusy(false);
            return;

          case "done":
            onReply((m) => ({ ...m, streaming: false, permissions: [] }));
            abortRef.current = null;
            setBusy(false);
            return;
        }
      };

      return onDelta;
    },
    [patch],
  );

  /* A prompt scheduled with /every or /after firing by itself. It lands in
     the open chat as a prompt and a streaming reply, like one the user sent,
     but never on top of a reply that is already streaming. */
  useEffect(() => {
    client.onExternalTurn((prompt, cancel) => {
      const convId = activeIdRef.current;
      if (!convId || abortRef.current) return null;
      const reply = { ...emptyMessage("assistant"), streaming: true };
      patch(convId, (msgs) => [...msgs, emptyMessage("user", prompt), reply]);
      abortRef.current = cancel;
      setBusy(true);
      return handlerFor(convId, reply.id);
    });
    return () => client.onExternalTurn(null);
  }, [client, patch, handlerFor]);

  const send = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body || busy) return;

      let id = activeId;
      const history = active?.messages ?? [];

      if (!id) {
        id = uid();
        const title = body.length > 54 ? `${body.slice(0, 54)}…` : body;
        setConversations((prev) => [
          { id: id as string, title, messages: [], updatedAt: Date.now() },
          ...prev,
        ]);
        setActiveId(id);
      }

      const convId = id;
      /* `selectChat` would do this too, but the ref must be current before the
         session id can land, and `setActiveId` has not re-rendered yet. */
      activeIdRef.current = convId;
      const reply = { ...emptyMessage("assistant"), streaming: true };
      patch(convId, (msgs) => [...msgs, emptyMessage("user", body), reply]);
      setBusy(true);
      setDetached(false);

      const onDelta = handlerFor(convId, reply.id);

      abortRef.current = client.send({ text: body, history }, onDelta);
    },
    [active, activeId, busy, client, patch, handlerFor],
  );

  const newChat = useCallback(() => {
    stop();
    selectChat(null);
    setDetached(false);
    void client.reset();
  }, [client, selectChat, stop]);

  const openChat = useCallback(
    (id: string) => {
      stop();
      selectChat(id);
      const conv = conversations.find((c) => c.id === id);
      if (!conv?.sessionId) {
        /* Never had a session, or already known to be gone. Only flag it as
           detached when there is a transcript to be detached from. */
        setDetached(conv ? conv.messages.length > 0 : false);
        return;
      }
      void client.resume(conv.sessionId).then((ok) => {
        setDetached(!ok);
        if (!ok) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, sessionId: undefined } : c)),
          );
        }
      });
    },
    [client, conversations, selectChat, stop],
  );

  const deleteChat = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        selectChat(null);
        setDetached(false);
      }
    },
    [activeId, selectChat],
  );

  const decide = useCallback(
    (requestId: string, decision: PermissionDecision) => {
      /* Hide the card immediately. The server echoes permission_resolved, but
         waiting for the round trip leaves the buttons live long enough to be
         double-clicked, and the second click is a 404. */
      if (activeId) {
        patch(activeId, (msgs) =>
          msgs.map((m) =>
            m.permissions.some((p) => p.id === requestId)
              ? { ...m, permissions: m.permissions.filter((p) => p.id !== requestId) }
              : m,
          ),
        );
      }
      void client.decide(requestId, decision);
    },
    [activeId, client, patch],
  );

  const configure = useCallback(
    (patchSettings: Parameters<ChatClient["configure"]>[0]) => {
      void client.configure(patchSettings);
    },
    [client],
  );

  /* Cancel any in-flight stream if the component unmounts, or the timers keep
     firing against a dead tree. */
  useEffect(() => () => abortRef.current?.(), []);

  return {
    conversations,
    active,
    activeId,
    messages,
    busy,
    detached,
    state,
    send,
    stop,
    newChat,
    openChat,
    deleteChat,
    decide,
    configure,
  };
}
