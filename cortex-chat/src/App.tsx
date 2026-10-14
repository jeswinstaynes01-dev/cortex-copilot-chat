import { useCallback, useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Thread } from "./components/Thread";
import { Composer } from "./components/Composer";
import { Welcome } from "./components/Welcome";
import { Suggestions } from "./components/Suggestions";
import { Icon } from "./components/Icons";
import { createCopilotClient } from "./lib/copilotClient";
import { createMockClient } from "./lib/mockClient";
import { watchActivity, detectPerfMode } from "./lib/ambient";
import { buildCommands } from "./lib/commands";
import { BUILT_IN_PROMPTS, deletePrompt, loadSavedPrompts, savePrompt } from "./lib/prompts";
import type { Prompt } from "./lib/prompts";
import { copyText, download, slug, toMarkdown } from "./lib/transcript";
import { useChat } from "./lib/useChat";
import type { ArchivedSession, Budget, Message, ModelOption, Persona } from "./lib/types";

/* `?mock` swaps the real agent for the simulator. Two reasons it exists:
   screenshots and visual tweaking should not burn real model calls or wait on
   a JVM, and the UI has to stay provably independent of the transport. Both
   clients implement the same `ChatClient` interface, so nothing below this
   line can tell which one it got. */
const useMock = new URLSearchParams(window.location.search).has("mock");

/* An archived turn is one user question and one assistant answer. The Thread
   component already knows how to render a list of Messages, so rather than
   build a second read-only renderer we flatten the archive into the shape it
   expects. Tools and permissions are empty because the store keeps only the
   text — which is the honest limit of what we can show. */
function toMessages(
  turns: Array<{ index: number; user?: string; assistant?: string; timestamp?: string }>,
): Message[] {
  const out: Message[] = [];
  for (const t of turns) {
    const at = Date.parse(t.timestamp ?? "") || Date.now();
    const base = { reasoning: "", tools: [], permissions: [], streaming: false, createdAt: at };
    if (t.user) out.push({ ...base, id: `a${t.index}u`, role: "user", text: t.user });
    if (t.assistant) {
      out.push({ ...base, id: `a${t.index}a`, role: "assistant", text: t.assistant });
    }
  }
  return out;
}

export default function App() {
  /* useMemo, not useState: the client is created once for the life of the tab.
     Rebuilding it on a re-render would drop the SSE connection mid-reply. */
  const client = useMemo(() => (useMock ? createMockClient() : createCopilotClient()), []);
  useEffect(() => () => client.dispose(), [client]);

  /* Both write attributes straight onto <html> rather than going through React.
     "Is the user moving the mouse" as state would re-render the whole tree on
     every pointermove — far more expensive than the animations being relieved.
     See ambient.ts for why this machine needs it more than most. */
  useEffect(() => {
    const stopActivity = watchActivity();
    const stopDetect = detectPerfMode();
    return () => {
      stopActivity();
      stopDetect();
    };
  }, []);

  const {
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
  } = useChat(client);

  const [draft, setDraft] = useState("");
  /* Lives here rather than in Thread so the composer toggle controls every
     bubble at once instead of each reply remembering its own setting. */
  const [showReasoning, setShowReasoning] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  const [archive, setArchive] = useState<ArchivedSession[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  /* The archived conversation currently being read, if any. Null means we are
     looking at a live chat. */
  const [viewing, setViewing] = useState<{ id: string; title: string; messages: Message[] } | null>(
    null,
  );

  useEffect(() => {
    void client.archive().then(setArchive);
  }, [client]);

  /* Spend is re-read whenever the agent stops working, because the turn that
     just finished is exactly what changed it. Polling on a timer would be
     wasted work on a page that is idle most of the time. */
  const refreshBudget = useCallback(() => void client.budget().then(setBudget), [client]);
  useEffect(() => {
    if (!busy) refreshBudget();
  }, [busy, refreshBudget]);

  /* Two facts only the config knows, both wanted by the status card: whether
     the model in use runs on the user's own key, and what the persona id is
     called. Asked for once settings exist, by which point the client already
     holds the config — so this reads its cache rather than the network. */
  const [models, setModels] = useState<ModelOption[]>([]);
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const connected = state.settings !== null;
  useEffect(() => {
    if (!connected) return;
    let live = true;
    client
      .models()
      .then((m) => live && setModels(m))
      .catch(() => undefined);
    client
      .personas()
      .then((p) => live && setPersonas(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, connected]);

  /* Saved prompts live here, not in the palette, because the palette is
     rebuilt from scratch every time it opens and the list has to survive
     that — and `/save` has to see it to say when a name will be replaced. */
  const [savedPrompts, setSavedPrompts] = useState<Prompt[]>(() => loadSavedPrompts());
  const prompts = useMemo(() => [...BUILT_IN_PROMPTS, ...savedPrompts], [savedPrompts]);

  /* One line of feedback for commands that change something off screen. It
     clears itself: a confirmation that stays up stops being read. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openArchived = useCallback(
    async (id: string) => {
      const meta = archive.find((a) => a.id === id);
      setViewing({ id, title: meta?.title ?? "Archived conversation", messages: [] });
      setRailOpen(false);
      setViewing({
        id,
        title: meta?.title ?? "Archived conversation",
        messages: toMessages(await client.archiveTurns(id)),
      });
    },
    [archive, client],
  );

  /* Closing the drawer on send is the mobile case: the rail covers the thread,
     so leaving it open means tapping Send and seeing nothing happen. */
  const onSend = (text: string) => {
    setViewing(null);
    send(text);
    setDraft("");
    setRailOpen(false);
  };

  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRailOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen]);

  const shown = viewing ? viewing.messages : messages;
  const empty = shown.length === 0 && !viewing;
  const lastUserMessage = shown.findLast((m) => m.role === "user")?.text ?? null;

  const settings = state.settings;
  const provider = models.find((m) => m.id === settings?.model)?.provider ?? null;
  const persona = personas?.find((p) => p.id === settings?.persona) ?? null;

  /* Built from the same handlers the buttons use, so a command can never do
     something a click cannot — or drift away from it later. Rebuilt whenever
     any input changes because the list is partly a readout: which model is
     ticked, whether /stop is available, why /export is not. */
  const commands = useMemo(
    () =>
      buildCommands({
        busy,
        settings: state.settings,
        conversation: active,
        conversations,
        showReasoning,
        loadModels: () => client.models(),
        personas,
        prompts,
        savedPrompts,
        lastUserMessage,
        checkDirectory: (p) => client.checkDirectory(p),
        onNewChat: () => {
          setViewing(null);
          newChat();
        },
        onOpenChat: (id) => {
          setViewing(null);
          openChat(id);
        },
        onStop: stop,
        onConfigure: configure,
        onToggleReasoning: () => setShowReasoning((v) => !v),
        onCopy: () => active && void copyText(toMarkdown(active)),
        onExport: () => active && download(`${slug(active.title)}.md`, toMarkdown(active)),
        onSavePrompt: (name, text) => {
          setSavedPrompts(savePrompt(name, text));
          setNotice(`Saved “${name}” — find it under /prompt`);
        },
        onDeletePrompt: (id) => {
          const gone = savedPrompts.find((p) => p.id === id);
          setSavedPrompts(deletePrompt(id));
          if (gone) setNotice(`Removed “${gone.name}”`);
        },
      }),
    [
      busy,
      state.settings,
      active,
      conversations,
      showReasoning,
      personas,
      prompts,
      savedPrompts,
      lastUserMessage,
      client,
      newChat,
      openChat,
      stop,
      configure,
    ],
  );

  return (
    <>
      {/* Fixed behind everything. Kept outside `.app` so it paints beneath the
          window without joining its stacking context. The drift is governed by
          `html[data-busy]` and `html[data-perf]` — see ambient.ts. */}
      <div className="backdrop" aria-hidden="true">
        <div className="backdrop__layer backdrop__layer--a" />
        <div className="backdrop__layer backdrop__layer--b" />
        <div className="backdrop__grain" />
      </div>

      <div className="app">
        <div className="window">
          <Sidebar
            conversations={conversations}
            archive={archive}
            budget={budget}
            activeId={viewing ? viewing.id : activeId}
            open={railOpen}
            status={state.status}
            usage={state.usage}
            error={state.error}
            model={state.settings?.model ?? null}
            provider={provider}
            persona={persona}
            workingDirectory={state.settings?.workingDirectory ?? null}
            onNewChat={() => {
              setViewing(null);
              newChat();
            }}
            onOpenChat={(id) => {
              setViewing(null);
              openChat(id);
              setRailOpen(false);
            }}
            onOpenArchived={(id) => void openArchived(id)}
            onDeleteChat={deleteChat}
            onClose={() => setRailOpen(false)}
          />

          {railOpen && (
            <button
              className="rail__scrim"
              aria-label="Close menu"
              onClick={() => setRailOpen(false)}
            />
          )}

          <main className="main">
            <TopBar
              label={state.label}
              settings={state.settings}
              conversation={active}
              busy={busy}
              loadModels={client.models}
              personas={personas}
              loadMcpServers={client.mcpServers}
              onConfigure={configure}
              onOpenMenu={() => setRailOpen(true)}
            />

            {/* Backend sessions are in-memory and die with the JVM, but this
                transcript is in localStorage and does not. Saying so is the
                honest alternative to letting the user ask a follow-up question
                about a conversation the agent has no memory of. */}
            {!viewing && detached && (
              <div className="banner" role="status">
                <Icon name="alert" size={15} />
                <span>
                  This chat is no longer attached to a live agent session — it
                  can’t remember what was said above. Your next message starts a
                  fresh one.
                </span>
              </div>
            )}

            {viewing && (
              <div className="banner banner--archive" role="status">
                <Icon name="archive" size={15} />
                <span>
                  Archived from the Copilot CLI — read-only. Sending a message
                  starts a new chat.
                </span>
                <button className="banner__close" onClick={() => setViewing(null)}>
                  Close
                </button>
              </div>
            )}

            {empty ? (
              <div className="thread scroller thread--empty">
                <div className="thread__inner">
                  <Welcome name="Jeswin" />
                  <Suggestions onPick={onSend} />
                </div>
              </div>
            ) : (
              <Thread
                messages={shown}
                showReasoning={showReasoning}
                onDecide={decide}
                onRetry={onSend}
              />
            )}

            <Composer
              busy={busy}
              draft={draft}
              offline={state.status === "offline"}
              showReasoning={showReasoning}
              commands={commands}
              notice={notice}
              onToggleReasoning={() => setShowReasoning((v) => !v)}
              onDraftChange={setDraft}
              onSend={onSend}
              onStop={stop}
            />
          </main>
        </div>
      </div>
    </>
  );
}
