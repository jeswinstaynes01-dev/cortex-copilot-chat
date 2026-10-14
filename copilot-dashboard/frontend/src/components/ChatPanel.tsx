import { useEffect, useState } from "react";
import { abortTurn, decidePermission, sendMessage } from "../api";
import type { SessionSummary } from "../types";
import { useSessionStream } from "../useSessionStream";
import { usePresence } from "../usePresence";
import Composer from "./Composer";
import { IconFolder, IconPanel } from "./Icons";
import Inspector from "./Inspector";
import MessageList from "./MessageList";
import PermissionPrompt from "./PermissionPrompt";

interface Props {
  session: SessionSummary;
  onError: (message: string) => void;
}

/**
 * Mirrors the 1180px breakpoint in styles.css. Above it the telemetry pane is a
 * third column; at or below it the pane overlays the chat behind a full-screen
 * scrim, so defaulting to open there would block the entire UI on load.
 */
const WIDE_LAYOUT = "(min-width: 1181px)";

export default function ChatPanel({ session, onError }: Props) {
  const { items, permissions, busy, usage, connected, events } = useSessionStream(session.id);
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window === "undefined" || window.matchMedia(WIDE_LAYOUT).matches,
  );
  const inspector = usePresence(inspectorOpen, 260);

  // Follow the breakpoint: reveal the pane when there is room, hide it when not.
  useEffect(() => {
    const query = window.matchMedia(WIDE_LAYOUT);
    const sync = (event: MediaQueryListEvent) => setInspectorOpen(event.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const handleSend = async (prompt: string) => {
    try {
      await sendMessage(session.id, prompt);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  const handleStop = async () => {
    try {
      await abortTurn(session.id);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  const handleDecision = async (
    requestId: string,
    decision: "approve" | "reject",
    feedback?: string,
  ) => {
    try {
      await decidePermission(session.id, requestId, decision, feedback);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  const tokenLabel =
    usage?.currentTokens != null
      ? `${usage.currentTokens.toLocaleString()}${
          usage.tokenLimit ? ` / ${usage.tokenLimit.toLocaleString()}` : ""
        }`
      : null;

  return (
    <div className={`workspace ${inspectorOpen ? "workspace--split" : ""}`}>
      <section className="panel chat">
        <header className="chat__header">
          <div className="chat__ident">
            <span className={`led ${connected ? "led--on" : "led--off"}`} aria-hidden="true" />
            <div className="chat__path" title={session.workingDirectory}>
              <IconFolder size={13} />
              <span>{session.workingDirectory}</span>
            </div>
          </div>

          <div className="chat__status">
            <span className="chip">{session.model}</span>
            {tokenLabel && (
              <span className="chip chip--mono" title="Context tokens used">
                {tokenLabel}
              </span>
            )}
            <span className={`chip ${busy ? "chip--live" : "chip--quiet"}`}>
              {busy ? "running" : connected ? "idle" : "offline"}
            </span>
            <button
              type="button"
              className={`icon-btn ${inspectorOpen ? "is-active" : ""}`}
              aria-label={inspectorOpen ? "Hide telemetry" : "Show telemetry"}
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <IconPanel size={17} />
            </button>
          </div>
        </header>

        <MessageList items={items} />

        {permissions.length > 0 && (
          <div className="permissions">
            {permissions.map((prompt) => (
              <PermissionPrompt key={prompt.requestId} prompt={prompt} onDecide={handleDecision} />
            ))}
          </div>
        )}

        <Composer disabled={busy} busy={busy} onSend={handleSend} onStop={handleStop} />
      </section>

      {inspector.mounted && (
        <>
          {/* Only rendered as a dismissible scrim below the 3-pane breakpoint. */}
          <button
            type="button"
            className={`inspector__backdrop ${inspector.className}`}
            aria-label="Close telemetry"
            onClick={() => setInspectorOpen(false)}
          />
          <Inspector
            events={events}
            items={items}
            usage={usage}
            connected={connected}
            busy={busy}
            presenceClass={inspector.className}
            onClose={() => setInspectorOpen(false)}
          />
        </>
      )}
    </div>
  );
}
