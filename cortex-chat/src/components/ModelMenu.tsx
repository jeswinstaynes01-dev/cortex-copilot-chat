import { useEffect, useRef, useState } from "react";
import type { ClientSettings, McpServer, ModelOption, Persona } from "../lib/types";
import { ripple } from "../lib/ripple";
import {
  EFFORT_DEFAULT_HINT,
  EFFORT_DEFAULT_LABEL,
  effortHint,
  effortLabel,
} from "../lib/effort";
import { Icon } from "./Icons";

interface Props {
  label: string;
  settings: ClientSettings | null;
  loadModels: () => Promise<ModelOption[]>;
  /** Null until the backend has answered. Empty hides the section. */
  personas: Persona[] | null;
  loadMcpServers: () => Promise<McpServer[]>;
  onConfigure: (patch: Partial<ClientSettings>) => void;
  /** Changing any setting restarts the agent session, so warn while busy. */
  busy: boolean;
}

/* "*" is the SDK's wildcard for every tool the server offers. */
function toolList(tools: string[]): string {
  if (tools.includes("*")) return "all";
  return tools.length ? tools.join(", ") : "none";
}

export function ModelMenu({
  label,
  settings,
  loadModels,
  personas,
  loadMcpServers,
  onConfigure,
  busy,
}: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  /* Null until known. A failed read leaves it null — the section stays
     hidden and is asked for again next time — rather than becoming an empty
     list, which would claim "no MCP servers" about a backend that never
     answered. */
  const [mcp, setMcp] = useState<McpServer[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* Fetched from the click that opens the menu rather than from an effect, and
     only the first time: the list is a round trip to the Copilot CLI on the
     server, and most sessions never open this menu at all. */
  const toggle = () => {
    if (open) return close();
    setOpen(true);
    if (mcp === null) {
      loadMcpServers()
        .then(setMcp)
        .catch(() => setMcp(null));
    }
    if (models.length > 0 || loading) return;
    setLoading(true);
    loadModels()
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  };

  /* Every close path goes through here so a half-answered confirmation can
     never be left armed, waiting to reappear the next time the menu opens. */
  function close() {
    setOpen(false);
    setConfirmAuto(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    /* Capture phase, so a click on a button inside another popover still
       closes this one before that button's own handler runs. */
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (id: string) => {
    close();
    if (id !== settings?.model) onConfigure({ model: id });
  };

  /* The efforts the CURRENTLY SELECTED model accepts, from the server's own
     answer. Not a constant: `auto` and some small models accept none, grok
     stops at "high", only Opus and GPT-6 reach "max". Offering a fixed list
     would mean offering choices the backend silently discards. */
  const current = models.find((m) => m.id === settings?.model);
  const efforts = current?.reasoningEfforts ?? [];
  const effort = settings?.reasoningEffort ?? null;

  const chooseEffort = (value: string | null) => {
    if (value === effort) return;
    onConfigure({ reasoningEffort: value });
  };

  const persona = settings?.persona ?? null;
  const activePersona = personas?.find((p) => p.id === persona) ?? null;
  const choosePersona = (id: string | null) => {
    if (id === persona) return;
    onConfigure({ persona: id });
  };

  /* Copilot's own models first, the user's own after, under a heading. The
     split is the one thing worth knowing before choosing: a model on your
     own key is not billed to Copilot, and it takes no reasoning effort. */
  const copilotModels = models.filter((m) => !m.provider);
  const ownModels = models.filter((m) => m.provider);
  const modelItem = (m: ModelOption) => (
    <button
      key={m.id}
      className="pop__item"
      role="menuitemradio"
      aria-checked={m.id === settings?.model}
      onClick={() => choose(m.id)}
      title={
        m.provider
          ? `Runs on your own ${m.provider} key or endpoint — not billed to GitHub Copilot`
          : undefined
      }
    >
      <span className="pop__item-name">{m.name}</span>
      {m.provider && <span className="pop__badge">{m.provider}</span>}
      {m.id === settings?.model && <Icon name="check" size={16} />}
    </button>
  );

  /* Turning auto-approve ON hands the agent unsupervised shell and file access
     for the rest of the session, so it gets a confirm step. Turning it OFF
     only ever makes things safer, so that direction stays a single click —
     a confirmation you can't say no to anything useful is just a speed bump. */
  const toggleAuto = (next: boolean) => {
    if (!next) {
      setConfirmAuto(false);
      onConfigure({ autoApprove: false });
      return;
    }
    setConfirmAuto(true);
  };

  return (
    <div className="pop" ref={rootRef}>
      <button
        className="modelpill ripple-host"
        onPointerDown={ripple}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="modelpill__dot">
          <Icon name="mark" size={13} />
        </span>
        {label}
        {/* Surfaced on the pill because it changes what you get back and is
            otherwise two clicks away. Omitted entirely when unset — "model
            default" is the normal state and labelling it would be noise. */}
        {effort && (
          <span className="modelpill__effort" data-effort={effort}>
            {effortLabel(effort)}
          </span>
        )}
        <Icon name="caret" size={15} className="modelpill__caret" />
      </button>

      {open && (
        <div className="pop__panel pop__panel--model scroller" role="menu">
          <div className="pop__title">Model</div>

          <div className="pop__list scroller">
            {loading && <div className="pop__empty">Loading…</div>}
            {!loading && models.length === 0 && (
              <div className="pop__empty">Backend unreachable</div>
            )}
            {copilotModels.map(modelItem)}
            {ownModels.length > 0 && (
              <div role="group" aria-label="Your own key">
                <div className="pop__group" aria-hidden="true">
                  Your own key
                </div>
                {ownModels.map(modelItem)}
              </div>
            )}
          </div>

          <div className="pop__rule" />

          {/* Only rendered once the model list has loaded, because until then we
              do not know what this model supports and must not guess. */}
          {!loading && models.length > 0 && (
            <div className="pop__effort">
              <div className="pop__title">Reasoning effort</div>

              {efforts.length === 0 ? (
                /* Nothing to offer — but say WHY, because the two reasons are
                   different and a silently missing control looks like a bug.
                   A disabled row of buttons would be worse: it implies the
                   setting exists and is merely unavailable right now. */
                <p className="pop__hint pop__hint--block">
                  {settings?.model === "auto"
                    ? "Auto chooses a model per request, so the effort cannot be set ahead of time."
                    : current?.provider
                      ? `${current.name} runs on your own ${current.provider} endpoint, which takes no reasoning effort.`
                      : `${current?.name ?? "This model"} does not expose a reasoning effort.`}
                </p>
              ) : (
                <>
                  <div className="pop__chips" role="radiogroup" aria-label="Reasoning effort">
                    {/* Null is a real choice, not an empty one: it means the
                        model applies its own default. It leads because it is
                        the state every new session starts in. */}
                    <button
                      className="pop__chip"
                      role="radio"
                      aria-checked={effort === null}
                      onClick={() => chooseEffort(null)}
                    >
                      {EFFORT_DEFAULT_LABEL}
                    </button>
                    {efforts.map((value) => (
                      <button
                        key={value}
                        className="pop__chip"
                        role="radio"
                        aria-checked={effort === value}
                        data-effort={value}
                        onClick={() => chooseEffort(value)}
                        title={effortHint(value)}
                      >
                        {effortLabel(value)}
                      </button>
                    ))}
                  </div>
                  <p className="pop__hint pop__hint--block">
                    {effort === null
                      ? EFFORT_DEFAULT_HINT
                      : (effortHint(effort) || `Runs at "${effort}".`)}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="pop__rule" />

          {/* Hidden rather than shown empty when the backend offers none:
              personas are configured on the server, so there is nothing a
              user could do here to make the section useful. */}
          {personas && personas.length > 0 && (
            <>
              <div className="pop__persona">
                <div className="pop__title">Persona</div>
                <div className="pop__chips" role="radiogroup" aria-label="Persona">
                  <button
                    className="pop__chip"
                    role="radio"
                    aria-checked={persona === null}
                    data-persona="none"
                    onClick={() => choosePersona(null)}
                  >
                    None
                  </button>
                  {personas.map((p) => (
                    <button
                      key={p.id}
                      className="pop__chip"
                      role="radio"
                      aria-checked={persona === p.id}
                      data-persona={p.id}
                      onClick={() => choosePersona(p.id)}
                      title={p.description}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <p className="pop__hint pop__hint--block">
                  {activePersona
                    ? activePersona.description
                    : "No persona. The agent works from its own instructions alone."}
                </p>
              </div>

              <div className="pop__rule" />
            </>
          )}

          <label className="pop__switch">
            <input
              type="checkbox"
              checked={settings?.autoApprove ?? false}
              onChange={(e) => toggleAuto(e.target.checked)}
            />
            <span className="pop__switch-track" aria-hidden="true">
              <span className="pop__switch-thumb" />
            </span>
            <span className="pop__switch-text">
              <span className="pop__item-name">Auto-approve tools</span>
              <span className="pop__hint">
                Run file and shell actions without asking first.
              </span>
            </span>
          </label>

          {confirmAuto && (
            <div className="pop__confirm" role="alertdialog" aria-label="Confirm auto-approve">
              <p className="pop__confirm-text">
                <Icon name="alert" size={15} />
                <span>
                  The agent will run shell commands and edit files in{" "}
                  <strong>{settings?.workingDirectory ?? "its working directory"}</strong> without
                  asking. Nothing will pause for your review.
                </span>
              </p>
              <div className="pop__confirm-actions">
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => {
                    setConfirmAuto(false);
                    onConfigure({ autoApprove: true });
                  }}
                >
                  Enable anyway
                </button>
                <button className="btn btn--sm" onClick={() => setConfirmAuto(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Read-only on purpose. Servers are configured in the backend's
              application.yml and handed to every session at creation; a
              toggle here would promise a control the server does not have. */}
          {mcp && (
            <>
              <div className="pop__rule" />
              <div className="pop__tools">
                <div className="pop__title">Tools (MCP)</div>
                {mcp.length === 0 ? (
                  <p className="pop__hint pop__hint--block">
                    No MCP servers — add them under copilot.mcp-servers in application.yml
                  </p>
                ) : (
                  <ul className="pop__tool-list" aria-label="MCP servers">
                    {mcp.map((s) => (
                      <li
                        key={s.name}
                        className="pop__tool"
                        title={`${s.type === "http" ? "URL" : "Command"}: ${s.target}\nTools: ${toolList(s.tools)}`}
                      >
                        <Icon name="plug" size={14} />
                        <span className="pop__item-name">{s.name}</span>
                        <span className="pop__badge">{s.type}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {settings?.workingDirectory && (
            <div className="pop__path" title={settings.workingDirectory}>
              <Icon name="folder" size={15} />
              <span>{settings.workingDirectory}</span>
            </div>
          )}

          <p className="pop__note">
            {busy
              ? "Changing this stops the current reply and starts a new agent session."
              : "Changing this starts a new agent session."}
          </p>
        </div>
      )}
    </div>
  );
}
