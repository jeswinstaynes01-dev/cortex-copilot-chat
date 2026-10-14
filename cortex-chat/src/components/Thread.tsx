import { useEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import type { Message, PermissionDecision, ToolCall } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { copyText } from "../lib/transcript";
import { Permission } from "./Permission";
import { Icon } from "./Icons";

const TOOL_STATE: Record<ToolCall["status"], string> = {
  running: "in progress",
  done: "finished",
  failed: "failed",
};

/* The runtime names a tool by what it set OUT to do — "Running command",
   "Reading file". That reads wrong once the tool has stopped: a green tick
   next to "Running command" says two contradictory things at once. This turns
   the leading verb into the past tense for the handful the runtime actually
   uses, and leaves any label it doesn't recognise completely alone, so an
   unexpected label degrades to "slightly odd" rather than "mangled". */
const PAST: Record<string, string> = {
  Running: "Ran",
  Reading: "Read",
  Writing: "Wrote",
  Editing: "Edited",
  Creating: "Created",
  Deleting: "Deleted",
  Searching: "Searched",
  Fetching: "Fetched",
  Listing: "Listed",
  Fixing: "Fixed",
};

function settledLabel(label: string) {
  const space = label.indexOf(" ");
  if (space < 1) return label;
  const past = PAST[label.slice(0, space)];
  return past ? past + label.slice(space) : label;
}

function Tools({ msg }: { msg: Message }) {
  if (!msg.tools.length) return null;
  return (
    <div className="tools">
      {msg.tools.map((t) => {
        const label = t.title ?? t.name;
        return (
          <div
            key={t.id}
            className="toolchip"
            data-status={t.status}
            title={t.detail ?? undefined}
          >
            <Icon
              name={t.status === "running" ? "retry" : t.status === "failed" ? "alert" : "check"}
              size={14}
              className={t.status === "running" ? "toolchip__spin" : undefined}
            />
            {t.status === "running" ? label : settledLabel(label)}
            {/* Colour and the tick carry the state for sighted users; this is
                the same information for everyone else. */}
            <span className="sr-only"> — {TOOL_STATE[t.status]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* Collapsed by default. The agent's thinking is long, repetitive and almost
   never the thing you came for — but when a reply is wrong it is the only
   place that explains why, so it has to be reachable. */
function Reasoning({ text, open }: { text: string; open: boolean }) {
  const [show, setShow] = useState(open);
  /* "Adjusting state during render": the global toggle in the composer should
     override whatever this one bubble was set to, but each bubble must still
     be independently openable afterwards. Comparing against the previous prop
     value does that in one pass, where an effect would need a second paint. */
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setShow(open);
  }

  if (!text.trim()) return null;

  return (
    <div className="reason" data-open={show}>
      <button className="reason__toggle" onClick={() => setShow((v) => !v)}>
        <Icon name="brain" size={14} />
        {show ? "Hide thinking" : "Show thinking"}
      </button>
      {show && <div className="reason__body">{text}</div>}
    </div>
  );
}

interface BubbleProps {
  msg: Message;
  showReasoning: boolean;
  onDecide: (id: string, decision: PermissionDecision) => void;
  /** The user prompt that produced this reply, for "Ask again". */
  prompt: string | null;
  onRetry: (text: string) => void;
  /** Only the newest reply explains a missing reasoning panel. */
  isLast: boolean;
}

function Bubble({ msg, showReasoning, onDecide, prompt, onRetry, isLast }: BubbleProps) {
  const [copied, setCopied] = useState(false);

  if (msg.role === "user") {
    return (
      <div className="msg msg--user">
        <div className="msg__bubble">
          <div className="msg__text">{msg.text}</div>
        </div>
      </div>
    );
  }

  /* "Waiting" is not the same as "thinking". While a permission card is open
     the agent is blocked on the user, so showing a typing animation would be
     an outright lie about who everyone is waiting for. Every other silent
     moment — including the gap after a tool finishes and before the answer
     starts arriving — does get the dots, or the screen looks dead. */
  const blocked = msg.permissions.length > 0;
  const idle = msg.streaming && !msg.text && !blocked;

  /* Thinking is on, the reply has finished, and the model produced no
     reasoning. Saying nothing here makes a working toggle look broken, because
     the user has no way to tell "this model does not expose its reasoning"
     from "the feature is dead". Only the latest reply says it, so a model that
     never reasons leaves one note rather than one per message. */
  const noReasoning = showReasoning && isLast && !msg.streaming && !msg.reasoning && !!msg.text;

  return (
    <div className="msg msg--assistant">
      <div className="msg__avatar" aria-hidden="true" />
      <div className="msg__bubble">
        <Reasoning text={msg.reasoning} open={showReasoning} />
        {noReasoning && (
          <p className="reason__none">
            <Icon name="brain" size={13} />
            This model didn’t share its reasoning for this turn.
          </p>
        )}
        <Tools msg={msg} />

        {msg.permissions.map((p) => (
          <Permission key={p.id} request={p} onDecide={onDecide} />
        ))}

        {idle ? (
          <div className="typing" aria-label="Assistant is working">
            <span />
            <span />
            <span />
          </div>
        ) : (
          msg.text && (
            <div className="md">
              {renderMarkdown(msg.text, msg.streaming)}
              {msg.streaming && <i className="caret" />}
            </div>
          )
        )}

        {msg.notice && (
          <p className="msg__notice">
            <Icon name="alert" size={14} />
            {msg.notice}
          </p>
        )}

        {!msg.streaming && msg.text && (
          <div className="msg__tools">
            <button
              className="iconbtn"
              aria-label="Copy reply"
              data-tip={copied ? "Copied" : "Copy"}
              onClick={async () => {
                if (await copyText(msg.text)) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }
              }}
            >
              <Icon name={copied ? "check" : "copy"} size={15} />
            </button>
            <button
              className="iconbtn"
              aria-label="Ask again"
              data-tip="Ask again"
              disabled={!prompt}
              onClick={() => prompt && onRetry(prompt)}
            >
              <Icon name="retry" size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  messages: Message[];
  showReasoning: boolean;
  onDecide: (id: string, decision: PermissionDecision) => void;
  onRetry: (text: string) => void;
}

export function Thread({ messages, showReasoning, onDecide, onRetry }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  /* Only auto-scroll when the user is already near the bottom. Yanking them
     back down while they are reading earlier replies is the single most
     irritating bug a chat UI can have. */
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const last = messages[messages.length - 1];
  /* Permission count is in the dependency list on purpose: a card appearing is
     a layout change the user must see, and it is the one case where scrolling
     them down is right even if they had drifted up. */
  useEffect(() => {
    if (stickRef.current || last?.permissions.length) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length, last?.text, last?.permissions.length, last?.tools.length]);

  return (
    <div className="thread scroller" onScroll={onScroll}>
      <div className="thread__inner">
        {messages.map((m, i) => (
          <Bubble
            key={m.id}
            msg={m}
            showReasoning={showReasoning}
            onDecide={onDecide}
            /* Walk back to the question this reply answered, rather than
               assuming it is always the message directly above. */
            prompt={
              messages
                .slice(0, i)
                .reverse()
                .find((p) => p.role === "user")?.text ?? null
            }
            onRetry={onRetry}
            isLast={i === messages.length - 1}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
