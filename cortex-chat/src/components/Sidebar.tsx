import { useMemo, useState } from "react";
import type {
  ArchivedSession,
  Budget,
  ConnectionStatus,
  Conversation,
  Persona,
  Usage,
} from "../lib/types";
import { ripple } from "../lib/ripple";
import { Icon } from "./Icons";

const DAY = 86_400_000;

/* Buckets by age rather than by date string, so "Today" stays correct across
   midnight without needing a re-render. */
function bucket(ts: number): string {
  const age = Date.now() - ts;
  if (age < DAY) return "Today";
  if (age < 2 * DAY) return "Yesterday";
  if (age < 7 * DAY) return "Previous 7 days";
  if (age < 30 * DAY) return "Previous 30 days";
  return "Older";
}

/* One row in the history list. `kind` is the important field: a live chat can
   be continued and deleted, an archived one can only be read, because the
   agent process that produced it exited long ago. Merging the two lists was a
   deliberate choice — to the user it is all just "my history" — but the row
   has to carry the distinction so the UI can honour it. */
interface Row {
  id: string;
  title: string;
  ts: number;
  kind: "live" | "archived";
  subtitle?: string;
  turns?: number;
}

function group(rows: Row[]) {
  const out: Array<{ label: string; items: Row[] }> = [];
  for (const r of rows) {
    const label = bucket(r.ts);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(r);
    else out.push({ label, items: [r] });
  }
  return out;
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "Ready",
  connecting: "Starting agent…",
  online: "Connected",
  offline: "Backend offline",
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function tokens(usage: Usage | null): string | null {
  if (!usage?.currentTokens) return null;
  const limit = usage.tokenLimit;
  /* No "tokens" suffix. The word costs about 45px, which is the difference
     between the status line reading "Connected" and reading "Connec…". The
     gauge icon and the tooltip carry the meaning instead. */
  return limit
    ? `${compact(usage.currentTokens)}/${compact(limit)}`
    : compact(usage.currentTokens);
}

/* Shows the last two segments of the working directory. Plain CSS truncation
   would cut the useful end off ("C:\Users\you…"), and the `direction: rtl`
   trick that fixes that mangles the backslashes, because the bidi algorithm
   is free to reorder punctuation. Trimming in JS is predictable; the full
   path stays in the `title`. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? path : `…\\${parts.slice(-2).join("\\")}`;
}

/* The effort the ledger says this model LAST RAN AT — an observation, not a
   setting. The CLI records effort per request, so this is read back from the
   usage store rather than from our own config, which is what makes it a useful
   independent confirmation that a chosen effort actually took.

   There used to be a fallback here: if this model had no recorded request, show
   the most recent effort from any model, on the grounds that it still answered
   "what is this machine doing". That was wrong, and the reasoning-effort
   control is what exposed it. Switching to Claude Haiku — a model that supports
   no reasoning effort at all — left this badge reading "MAX", borrowed from a
   different model's request, directly beside a panel correctly stating that
   Haiku has no effort setting. A badge next to a model name is read as a claim
   about THAT model. If we have not seen it run, we have nothing to say. */
function effortFor(budget: Budget | null, model: string | null): string | null {
  if (!budget || !model) return null;
  return budget.models.find((m) => m.model === model)?.effort ?? null;
}

/* "auto" is not a model — it is an instruction to the runtime to pick one. So
   showing the literal string tells the user nothing about what is answering
   them. When the session is on auto we show the model the ledger says actually
   ran, and mark it so the substitution is never mistaken for a fixed choice. */
function resolveModel(model: string | null, budget: Budget | null) {
  if (model && model !== "auto") return { name: model, auto: false };
  if (budget?.model) return { name: budget.model, auto: true };
  return { name: model, auto: false };
}

/* "1 Nov". Formatted in UTC because the allowance resets at midnight UTC on
   the first: read in local time anywhere west of Greenwich, that instant is
   still the evening of the 31st, and the card would name the wrong day. */
function resetDay(iso: string | null, month: "short" | "long" = "short"): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month, timeZone: "UTC" });
}

const ESTIMATE_WHY =
  "An estimate. Your Copilot account's live quota couldn't be read, so this is summed " +
  "from the Copilot CLI's usage ledger on this machine and compared with the budget set " +
  "in the backend's config. Requests made on other machines aren't counted.";

/* The allowance line, in the four shapes it can honestly take. A bar is only
   drawn when there is a real limit to measure against AND the model in use
   draws from it — a full bar over a model on the user's own key would be
   warning about a bill that model never adds to. */
function Allowance({
  budget,
  provider,
  model,
}: {
  budget: Budget | null;
  provider: string | null;
  model: string | null;
}) {
  if (provider) {
    return (
      <div
        className="budget"
        data-kind="own"
        title={
          `${model ?? "This model"} runs on your own ${provider} key or endpoint, so it isn't ` +
          "billed to GitHub Copilot and uses none of your premium requests."
        }
      >
        <div className="budget__text">
          <span>Own model · {provider}</span>
          <span className="budget__note">not billed to Copilot</span>
        </div>
      </div>
    );
  }

  if (!budget) return null;

  const machine =
    `${budget.requests.toLocaleString()} requests across ${budget.sessions} sessions` +
    `\n${compact(budget.tokens)} tokens`;

  if (budget.unlimited) {
    return (
      <div
        className="budget"
        data-kind="unlimited"
        title={`Your Copilot plan has no premium-request cap.\nOn this machine this month: ${machine}`}
      >
        <div className="budget__text">
          <span>Unlimited</span>
          <span className="budget__note">premium requests</span>
        </div>
      </div>
    );
  }

  /* A zero budget is a plan with no premium allowance at all, so anything
     spent is already all of it — and dividing by it would draw NaN. */
  const pct =
    budget.budget > 0 ? Math.min(100, (budget.used / budget.budget) * 100) : budget.used > 0 ? 100 : 0;
  const level = pct >= 90 ? "critical" : pct >= 75 ? "warn" : "ok";
  const account = budget.source === "account";
  const resets = account ? resetDay(budget.resetDate) : null;
  const left = budget.remainingPercent == null ? "" : ` (${Math.round(budget.remainingPercent)}% left)`;

  return (
    <div
      className="budget"
      data-level={level}
      data-kind={budget.source}
      title={
        account
          ? `${budget.used.toLocaleString()} of ${budget.budget.toLocaleString()} premium requests ` +
            `used${left}, live from your GitHub Copilot account.` +
            (resets ? ` Resets ${resetDay(budget.resetDate, "long")}.` : "") +
            `\nOn this machine: ${machine}`
          : `${budget.used.toLocaleString()} of ${budget.budget.toLocaleString()} premium requests ` +
            `used in ${budget.month} (estimated)\n${machine}`
      }
    >
      <div className="budget__bar">
        <span className="budget__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="budget__text">
        <span>
          {compact(budget.used)} / {compact(budget.budget)}
          {!account && (
            <span className="budget__est" title={ESTIMATE_WHY}>
              est.
            </span>
          )}
        </span>
        <span className="budget__note">{resets ? `resets ${resets}` : "this month"}</span>
      </div>
    </div>
  );
}

interface Props {
  conversations: Conversation[];
  archive: ArchivedSession[];
  budget: Budget | null;
  activeId: string | null;
  open: boolean;
  status: ConnectionStatus;
  usage: Usage | null;
  error: string | null;
  model: string | null;
  /** Who serves the model in use: null for Copilot, else the BYOK provider. */
  provider: string | null;
  /** The persona the current session was created with, if any. */
  persona: Persona | null;
  workingDirectory: string | null;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onOpenArchived: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onClose: () => void;
}

/* The four nav items (Explore / Library / Files / History) and the sign-out
   button are gone. None had a destination; "History" in particular duplicated
   the list directly beneath it. The search box stayed, but it now filters. */
export function Sidebar({
  conversations,
  archive,
  budget,
  activeId,
  open,
  status,
  usage,
  error,
  model,
  provider,
  persona,
  workingDirectory,
  onNewChat,
  onOpenChat,
  onOpenArchived,
  onDeleteChat,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");

  const rows = useMemo<Row[]>(() => {
    const live: Row[] = conversations.map((c) => ({
      id: c.id,
      title: c.title,
      ts: c.updatedAt,
      kind: "live",
    }));

    /* A conversation started in this app is ALSO written to the CLI's store,
       so without this it would appear twice — once as a live chat and once as
       an archived one. The live copy wins: it is the one you can continue. */
    const claimed = new Set(conversations.map((c) => c.sessionId).filter(Boolean));

    const old: Row[] = archive
      .filter((a) => !claimed.has(a.id))
      .map((a) => ({
        id: a.id,
        title: a.title,
        ts: Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0,
        kind: "archived",
        subtitle: a.repository ?? (a.workingDirectory ? shortPath(a.workingDirectory) : undefined),
        turns: a.turns,
      }));

    return [...live, ...old].sort((a, b) => b.ts - a.ts);
  }, [conversations, archive]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return group(rows);
    const bodies = new Map(
      conversations.map((c) => [c.id, c.messages.map((m) => m.text).join("\n").toLowerCase()]),
    );
    return group(
      rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.subtitle?.toLowerCase().includes(q) ||
          /* Searching bodies as well as titles, because the title is only
             the first 54 characters of the opening question. Archived rows
             have no body loaded, so they match on title and repo alone. */
          bodies.get(r.id)?.includes(q),
      ),
    );
  }, [rows, conversations, query]);

  const usageText = tokens(usage);
  const shownModel = resolveModel(model, budget);
  const effort = effortFor(budget, shownModel.name);

  return (
    <aside
      id="rail"
      className={`rail${open ? " rail--open" : ""}`}
      aria-label="Chats and connection"
    >
      <div className="rail__head">
        <div className="brand">
          <span className="brand__mark">
            <Icon name="mark" size={19} />
          </span>
          <span className="brand__name">Cortex</span>
        </div>

        <button className="iconbtn rail__close" onClick={onClose} aria-label="Close menu">
          <Icon name="collapse" size={19} />
        </button>
      </div>

      <button
        className="btn btn--dark rail__new ripple-host"
        onPointerDown={ripple}
        onClick={onNewChat}
      >
        <Icon name="plus" size={18} />
        New chat
      </button>

      <div className="search">
        <Icon name="search" size={17} />
        <input
          type="search"
          placeholder="Search chats"
          aria-label="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search__clear" onClick={() => setQuery("")} aria-label="Clear search">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="rail__rule" />

      <div className="history scroller">
        {rows.length === 0 && (
          <p className="history__empty">No conversations yet. Ask something to start one.</p>
        )}
        {rows.length > 0 && groups.length === 0 && (
          <p className="history__empty">Nothing matches “{query}”.</p>
        )}

        {groups.map((g, gi) => (
          <div key={`${g.label}-${gi}`}>
            <div className="history__group">{g.label}</div>
            {g.items.map((r) => (
              <div
                key={`${r.kind}-${r.id}`}
                className="history__row"
                data-active={r.id === activeId || undefined}
                data-kind={r.kind}
              >
                <button
                  className="history__item"
                  title={
                    r.kind === "archived"
                      ? `${r.title}\n${r.subtitle ?? ""}\n${r.turns} turns · read-only`
                      : r.title
                  }
                  aria-current={r.id === activeId ? "true" : undefined}
                  onClick={() => (r.kind === "live" ? onOpenChat(r.id) : onOpenArchived(r.id))}
                >
                  {r.kind === "archived" && (
                    <Icon name="archive" size={14} className="history__icon" />
                  )}
                  <span className="history__label">{r.title}</span>
                </button>
                {r.kind === "live" ? (
                  <button
                    className="history__del"
                    aria-label={`Delete ${r.title}`}
                    onClick={() => onDeleteChat(r.id)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                ) : (
                  <span className="history__turns" aria-hidden="true">
                    {r.turns}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Replaces the fake user card. A signed-in identity the app never
          authenticated was decoration; what actually matters is whether the
          agent is reachable, which model is answering, where it is pointed,
          and how much of the month's allowance is left. */}
      <div className="status">
        <div className="status__line" title={error ?? undefined}>
          <span className="status__dot" data-status={status} aria-hidden="true" />
          <span className="status__meta">
            <span className="status__text">{error ? "Backend offline" : STATUS_TEXT[status]}</span>
            {workingDirectory && (
              <span className="status__sub" title={workingDirectory}>
                {shortPath(workingDirectory)}
              </span>
            )}
          </span>
          {usageText && (
            <span className="status__tokens" title="Context used in this agent session">
              <Icon name="gauge" size={14} />
              {usageText}
            </span>
          )}
        </div>

        {shownModel.name && (
          <div
            className="status__model"
            title={
              shownModel.auto
                ? `Model set to "auto" — the runtime most recently chose ${shownModel.name}`
                : `Model in use: ${shownModel.name}`
            }
          >
            <Icon name="chip" size={14} />
            {shownModel.auto && <span className="status__auto">auto</span>}
            <span className="status__modelname">{shownModel.name}</span>
            {effort && (
              <span
                className="status__effort"
                data-effort={effort}
                title={`The last recorded request on ${shownModel.name} ran at "${effort}" reasoning effort. This is read from the usage ledger — it is what happened, not what this chat is set to.`}
              >
                <span className="status__effort-label">{"ran "}</span>
                {effort}
              </span>
            )}
          </div>
        )}

        {/* Its own line rather than a fourth pill beside the model, which
            already has to fit a name, "auto" and the effort in 230px. */}
        {persona && (
          <div
            className="status__persona"
            title={
              `Persona: ${persona.name} — ${persona.description}\n` +
              "Applied when the session was created. Change it from the model menu or /persona."
            }
          >
            <Icon name="persona" size={13} />
            <span className="status__persona-name">{persona.name}</span>
          </div>
        )}

        <Allowance budget={budget} provider={provider} model={model} />
      </div>
    </aside>
  );
}
