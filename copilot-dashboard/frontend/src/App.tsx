import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import ChatPanel from "./components/ChatPanel";
import GridField from "./components/GridField";
import { IconClose, IconMenu, IconPlus, IconRadar } from "./components/Icons";
import NewSessionForm, { type ModelOption } from "./components/NewSessionForm";
import Sidebar from "./components/Sidebar";
import type { SessionSummary } from "./types";
import { usePresence } from "./usePresence";

interface BackendConfig {
  defaultModel: string;
  defaultWorkingDirectory: string;
  models?: ModelOption[];
}

const FALLBACK_MODELS: ModelOption[] = [{ id: "auto", name: "Auto" }];

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const formPresence = usePresence(showForm, 240);
  const drawerPresence = usePresence(drawerOpen, 300);

  const refresh = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setConfig(null));
    refresh();
  }, [refresh]);

  // Keep sidebar badges (busy/title) roughly in sync without a second event stream.
  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Escape closes whichever overlay is on top.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showForm) setShowForm(false);
      else setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showForm]);

  const handleCreate = async (input: {
    model: string;
    workingDirectory: string;
    autoApprove: boolean;
  }) => {
    setCreating(true);
    try {
      const created = await api.createSession(input);
      setShowForm(false);
      setActiveId(created.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSession(id);
      if (activeId === id) setActiveId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /**
   * Always closing the drawer is safe: above 900px the sidebar is a static grid
   * column, so the `sidebar--open` class has no effect there.
   */
  const handleSelect = (id: string) => {
    setActiveId(id);
    setDrawerOpen(false);
  };

  const active = sessions.find((session) => session.id === activeId) ?? null;
  const runningCount = sessions.filter((session) => session.busy).length;

  return (
    <div className="app">
      <GridField />

      <Sidebar
        sessions={sessions}
        activeId={activeId}
        open={drawerOpen}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onNew={() => {
          setShowForm(true);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
      />

      {drawerPresence.mounted && (
        <button
          type="button"
          className={`sidebar__backdrop ${drawerPresence.className}`}
          aria-label="Close sessions menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar__menu"
            aria-label="Open sessions menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <IconMenu />
          </button>

          <div className="topbar__id">
            <span className="eyebrow">{active ? "Active session" : "Control"}</span>
            <h2 className="topbar__title">{active ? active.title : "Copilot Dashboard"}</h2>
          </div>

          <div className="readouts" role="group" aria-label="Fleet status">
            <div className="readout">
              <span className="readout__label">Sessions</span>
              <span className="readout__value">{String(sessions.length).padStart(2, "0")}</span>
            </div>
            <div className={`readout ${runningCount ? "readout--live" : ""}`}>
              <span className="readout__label">Running</span>
              <span className="readout__value">{String(runningCount).padStart(2, "0")}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setShowForm(true)}
          >
            <IconPlus size={15} />
            <span className="btn__text">New session</span>
          </button>
        </header>

        {error && (
          <div className="banner banner--error" role="alert">
            <span className="banner__text">{error}</span>
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <IconClose size={15} />
            </button>
          </div>
        )}

        {active ? (
          <ChatPanel key={active.id} session={active} onError={setError} />
        ) : (
          <div className="empty">
            <div className="empty__art" aria-hidden="true">
              <IconRadar size={56} />
              <span className="empty__ping" />
            </div>
            <span className="eyebrow">No signal</span>
            <h2 className="empty__title">No session selected</h2>
            <p className="empty__body">
              Create a session to start a conversation. Each session runs the Copilot agent against a
              working directory of your choice.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => setShowForm(true)}>
              <IconPlus size={15} />
              <span className="btn__text">New session</span>
            </button>
          </div>
        )}
      </main>

      {formPresence.mounted && (
        <NewSessionForm
          defaultWorkingDirectory={config?.defaultWorkingDirectory ?? ""}
          models={config?.models?.length ? config.models : FALLBACK_MODELS}
          busy={creating}
          presenceClass={formPresence.className}
          onCreate={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
