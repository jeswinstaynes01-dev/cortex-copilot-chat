import { useMemo, useState } from "react";
import type { ChatItem, LoggedEvent, ToolItem, UsageInfo } from "../types";
import { IconActivity, IconClose } from "./Icons";

interface Props {
  events: LoggedEvent[];
  items: ChatItem[];
  usage: UsageInfo | null;
  connected: boolean;
  busy: boolean;
  presenceClass: string;
  onClose: () => void;
}

type Tab = "tools" | "events";

/**
 * Colour family for an event-type pill. Red is reserved for genuine failures,
 * so those are matched first; lifecycle and transport chatter (dashboard.*,
 * session.*) falls through to the neutral base styling.
 */
function familyOf(type: string): string {
  if (type.endsWith(".error") || type.endsWith(".aborted")) return "red";
  if (type.startsWith("assistant.")) return "lime";
  if (type.startsWith("tool.")) return "aqua";
  return "muted";
}

function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });
}

function stringify(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function Inspector({
  events,
  items,
  usage,
  connected,
  busy,
  presenceClass,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("tools");
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  const [openTool, setOpenTool] = useState<string | null>(null);

  const tools = useMemo(
    () => items.filter((item): item is ToolItem => item.kind === "tool"),
    [items],
  );

  const pct =
    usage?.currentTokens != null && usage.tokenLimit
      ? Math.min(100, (usage.currentTokens / usage.tokenLimit) * 100)
      : null;

  return (
    <aside className={`panel inspector ${presenceClass}`}>
      <header className="inspector__head">
        <span className="inspector__heading">
          <IconActivity size={15} />
          Telemetry
        </span>
        <button type="button" className="icon-btn icon-btn--sm" aria-label="Close telemetry" onClick={onClose}>
          <IconClose size={15} />
        </button>
      </header>

      <div className="tiles">
        <div className="tile">
          <span className="tile__label">Link</span>
          <span className={`tile__value ${connected ? "is-ok" : "is-bad"}`}>
            <span className={`led ${connected ? "led--on" : "led--off"}`} aria-hidden="true" />
            {connected ? "live" : "lost"}
          </span>
        </div>
        <div className="tile">
          <span className="tile__label">State</span>
          <span className={`tile__value ${busy ? "is-busy" : ""}`}>{busy ? "working" : "idle"}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Tools</span>
          <span className="tile__value">{String(tools.length).padStart(2, "0")}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Events</span>
          <span className="tile__value">{String(events.length).padStart(3, "0")}</span>
        </div>
      </div>

      {pct != null && (
        <div className="gauge">
          <div className="gauge__top">
            <span className="gauge__label">Context</span>
            <span className="gauge__num">
              {usage?.currentTokens?.toLocaleString()} / {usage?.tokenLimit?.toLocaleString()}
            </span>
          </div>
          <div className="gauge__bar">
            <div
              className={`gauge__fill ${pct > 85 ? "gauge__fill--hot" : ""}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="inspector__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tools"}
          className={`inspector__tab ${tab === "tools" ? "is-active" : ""}`}
          onClick={() => setTab("tools")}
        >
          Tools
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "events"}
          className={`inspector__tab ${tab === "events" ? "is-active" : ""}`}
          onClick={() => setTab("events")}
        >
          Events
        </button>
        <span className={`inspector__ink inspector__ink--${tab}`} aria-hidden="true" />
      </div>

      <div className="inspector__body" key={tab}>
        {tab === "tools" && (
          <>
            {tools.length === 0 && <p className="inspector__empty">No tool calls yet.</p>}
            {tools.map((tool) => {
              const open = openTool === tool.id;
              return (
                <div key={tool.id} className={`insp-row insp-row--${tool.status}`}>
                  <button
                    type="button"
                    className="insp-row__head"
                    aria-expanded={open}
                    onClick={() => setOpenTool(open ? null : tool.id)}
                  >
                    <span className={`led led--${tool.status}`} aria-hidden="true" />
                    <span className="insp-row__name">{tool.toolTitle || tool.toolName}</span>
                  </button>
                  {open && (
                    <div className="insp-row__body">
                      {tool.args != null && (
                        <>
                          <div className="insp-label">Arguments</div>
                          <pre>{stringify(tool.args)}</pre>
                        </>
                      )}
                      {tool.result && (
                        <>
                          <div className="insp-label">Result</div>
                          <pre>
                            {tool.result.length > 3000
                              ? `${tool.result.slice(0, 3000)}…`
                              : tool.result}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {tab === "events" && (
          <>
            {events.length === 0 && <p className="inspector__empty">Waiting for events…</p>}
            {[...events].reverse().map((event) => {
              const open = openEvent === event.seq;
              return (
                <div key={event.seq} className="insp-row">
                  <button
                    type="button"
                    className="insp-row__head"
                    aria-expanded={open}
                    onClick={() => setOpenEvent(open ? null : event.seq)}
                  >
                    <span className={`ev-pill ev-pill--${familyOf(event.type)}`}>{event.type}</span>
                    <span className="insp-row__time">{clock(event.timestamp)}</span>
                  </button>
                  {open && (
                    <div className="insp-row__body">
                      <pre>{stringify(event.payload) || "(no payload)"}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
