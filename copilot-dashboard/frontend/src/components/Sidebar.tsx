import type { CSSProperties } from "react";
import type { SessionSummary } from "../types";
import { IconClose, IconDrone, IconFolder, IconPlus, IconTrash } from "./Icons";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export default function Sidebar({
  sessions,
  activeId,
  open,
  onSelect,
  onDelete,
  onNew,
  onClose,
}: Props) {
  return (
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div className="sidebar__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <IconDrone size={18} />
          </span>
          <span className="brand__text">
            <span className="brand__name">Copilot</span>
            <span className="brand__sub">Mission Control</span>
          </span>
          <button
            type="button"
            className="icon-btn sidebar__close"
            aria-label="Close sessions menu"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        <button type="button" className="btn btn--primary btn--block" onClick={onNew}>
          <IconPlus size={15} />
          <span className="btn__text">New session</span>
        </button>
      </div>

      <div className="sidebar__sectionhead">
        <span className="eyebrow">Sessions</span>
        <span className="eyebrow eyebrow--dim">{String(sessions.length).padStart(2, "0")}</span>
      </div>

      <nav className="sidebar__list" aria-label="Sessions">
        {sessions.length === 0 && (
          <p className="sidebar__empty">No sessions yet. Create one to bring an agent online.</p>
        )}

        {sessions.map((session, index) => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            aria-current={session.id === activeId}
            // Drives the staggered entry animation in styles.css.
            style={{ "--i": index } as CSSProperties}
            className={`session-card ${session.id === activeId ? "session-card--active" : ""}`}
            onClick={() => onSelect(session.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(session.id);
              }
            }}
          >
            <div className="session-card__top">
              <span
                className={`led ${session.busy ? "led--busy" : "led--idle"}`}
                aria-hidden="true"
              />
              <span className="session-card__title">{session.title}</span>
              <button
                type="button"
                className="icon-btn icon-btn--sm session-card__delete"
                title="Delete session"
                aria-label={`Delete session ${session.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(session.id);
                }}
              >
                <IconTrash size={14} />
              </button>
            </div>

            <div className="session-card__path" title={session.workingDirectory}>
              <IconFolder size={12} />
              <span>{session.workingDirectory}</span>
            </div>

            <div className="session-card__meta">
              <span className="chip">{session.model}</span>
              {session.autoApprove && <span className="chip chip--warn">auto</span>}
              {session.busy && <span className="chip chip--live">running</span>}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
