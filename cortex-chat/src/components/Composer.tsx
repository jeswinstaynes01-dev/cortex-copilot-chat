import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ripple } from "../lib/ripple";
import { parseSlash } from "../lib/commands";
import type { Command } from "../lib/commands";
import { CommandPalette } from "./CommandPalette";
import type { PaletteApi } from "./CommandPalette";
import { Icon } from "./Icons";

interface Props {
  busy: boolean;
  draft: string;
  /** No backend session yet, or the stream dropped. */
  offline: boolean;
  showReasoning: boolean;
  commands: Command[];
  /** A one-off confirmation from a command, e.g. after `/save`. Shown in the
   *  hint line until the parent clears it. */
  notice: string | null;
  onToggleReasoning: () => void;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

/* The composer used to carry six controls that did nothing: an image picker, a
   "prompt ideas" bulb, a model-settings chip, a web-browsing globe, "Saved
   prompts" and "Attach file". The agent already reads files from its working
   directory and already browses when it decides to, so none of them had a
   switch behind them. What is left is the one toggle that maps to real data.
   Saved prompts did come back, once there was a library behind them — as
   `/prompt` and `/save` in the palette, not as another button here. */
export function Composer({
  busy,
  draft,
  offline,
  showReasoning,
  commands,
  notice,
  onToggleReasoning,
  onDraftChange,
  onSend,
  onStop,
}: Props) {
  const [focused, setFocused] = useState(false);
  /* Escape dismisses the palette without clearing the draft, so there has to
     be a way to say "this text starts with a slash but I am not commanding".
     Reset on every change, because typing again means they want it back. */
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const palette = useRef<PaletteApi | null>(null);
  /* Set when a prompt is inserted from the palette, and acted on once the new
     text has rendered: focus back in the box, caret at the very end, under
     the template's "Story:" line where the pasted material goes. */
  const caretToEnd = useRef(false);

  /* Grow-with-content. Height is reset to `auto` first so the textarea can
     shrink again — read `scrollHeight` without that reset and it only ever
     ratchets upwards. The cap matches `max-height` in the CSS, after which
     the element scrolls instead. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 184)}px`;
  }, [draft]);

  useEffect(() => {
    const el = ref.current;
    if (!caretToEnd.current || !el) return;
    caretToEnd.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  }, [draft]);

  const ready = draft.trim().length > 0 && !busy;

  /* The palette is a function of the draft, not a mode that gets switched on.
     That is what makes Backspace close it for free: delete the "/" and the
     string no longer parses as a command. */
  const slash = dismissed ? null : parseSlash(draft, commands);

  const changeDraft = (v: string) => {
    setDismissed(false);
    onDraftChange(v);
  };

  const submit = () => {
    if (!ready) return;
    onSend(draft);
    onDraftChange("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    /* IME first, and for every branch below. Without this, confirming a
       Japanese or Chinese candidate with Enter would fire the message — and
       with the palette open it would also run whatever row was highlighted. */
    if (e.nativeEvent.isComposing) return;

    if (slash && palette.current) {
      const api = palette.current;

      if (e.key === "ArrowDown") return stopAnd(e, () => api.move(1));
      if (e.key === "ArrowUp") return stopAnd(e, () => api.move(-1));
      /* Tab completes rather than moving focus — the palette is a list of
         names being typed, so completion is the meaning Tab already has in a
         terminal, which is where this gesture comes from. */
      if (e.key === "Tab") return stopAnd(e, () => api.accept());
      if (e.key === "Escape") {
        e.preventDefault();
        /* Back out one level at a time: confirm → option list → closed.
           Escape jumping straight to closed would discard a half-typed
           command the user was only trying to correct. */
        if (!api.back()) setDismissed(true);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        /* False means nothing was highlighted — an unmatched "/something".
           That is a real message, and it gets sent rather than swallowed. */
        if (!api.accept()) submit();
        return;
      }
    }

    /* Enter sends, Shift+Enter inserts a newline. */
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      {slash && (
        <CommandPalette
          state={slash}
          commands={commands}
          onDraft={changeDraft}
          inputRef={ref}
          onDone={() => {
            onDraftChange("");
            /* Focus is returned explicitly because a pointer-selected row
               takes it away, and the next thing anyone does after running a
               command is type. */
            ref.current?.focus();
          }}
          onInsert={(text) => {
            onDraftChange(text);
            /* A saved prompt that happens to start with "/" is a message,
               not a command, so the palette must not reopen over it. */
            setDismissed(text.startsWith("/"));
            caretToEnd.current = true;
          }}
          controller={(api) => {
            palette.current = api;
          }}
        />
      )}

      <div className="composer">
        <textarea
          ref={ref}
          className="composer__field"
          rows={1}
          value={draft}
          placeholder="Ask me anything..."
          aria-label="Message"
          onChange={(e) => changeDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />

        <div className="composer__row">
          <button
            className="toggle ripple-host"
            aria-pressed={showReasoning}
            data-tip="Expand the agent's thinking"
            onPointerDown={ripple}
            onClick={onToggleReasoning}
          >
            <Icon name="brain" size={17} />
            <span className="toggle__label">Thinking</span>
          </button>

          <div className="composer__spacer" />

          {busy ? (
            <button className="send" onClick={onStop} aria-label="Stop generating" data-tip="Stop">
              <Icon name="stop" size={15} />
            </button>
          ) : (
            /* Genuinely disabled when there is nothing to send. The old build
               showed a mic here instead, which promised voice input that did
               not exist. */
            <button
              className="send"
              onClick={submit}
              disabled={!ready}
              aria-label="Send message"
              data-tip="Send"
            >
              <Icon name="send" size={17} />
            </button>
          )}
        </div>
      </div>

      {/* Kept mounted (not conditionally rendered) so the layout height never
          jumps — it fades and the reserved space stays constant. */}
      <p
        className="composer__hint"
        data-show={!!notice || busy || focused || draft.length > 0 || offline}
        data-notice={!!notice}
      >
        {notice ??
          (busy
            ? "Working… press Stop to interrupt."
            : offline
              ? "Backend unreachable — start the Spring Boot app on :8080."
              : "Enter to send · Shift + Enter for a new line · / for commands")}
      </p>
      {/* The hint line changes on every send, so it is not a live region —
          announcing "Working…" each time would be noise. Confirmations are
          the one thing worth hearing, so they get a live region of their own,
          mounted from the start because one that appears with its text
          already inside is often not read at all. */}
      <span className="sr-only" role="status">
        {notice ?? ""}
      </span>
    </div>
  );
}

/** Consume a key event, then act. Both halves are needed every time: without
 *  `preventDefault` the arrow keys also move the text cursor, and without
 *  `stopPropagation` Escape reaches whatever else is listening for it. */
function stopAnd(e: KeyboardEvent<HTMLTextAreaElement>, fn: () => void) {
  e.preventDefault();
  e.stopPropagation();
  fn();
}
