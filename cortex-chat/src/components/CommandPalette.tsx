import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Command, CommandOption, SlashState } from "../lib/commands";
import { filterByQuery, hasOptions } from "../lib/commands";
import { Icon } from "./Icons";

/**
 * CommandPalette — the list that appears above the composer when the draft
 * starts with "/".
 *
 * WHY IT IS DRIVEN BY THE DRAFT RATHER THAN BY ITS OWN STATE
 *
 * The textarea stays focused the entire time and remains the single source of
 * truth for what has been typed. The palette is a view of that string. This is
 * what makes Backspace work without any code: deleting the "/" ends the
 * command because the string no longer starts with one, not because anything
 * listened for the keystroke. A palette with its own input would need to
 * mirror focus, re-implement selection and decide what happens when the two
 * disagree.
 *
 * The only state owned here is which row is highlighted, plus the pending
 * confirmation — both are about the list, not about the text.
 */

/** Long enough that typing a path does not fire a request per character,
 *  short enough that the answer feels like a reaction to what you typed. */
const DEBOUNCE_MS = 220;

interface Props {
  state: SlashState;
  commands: Command[];
  /** Replaces the draft, used to advance "/mod" to "/model ". */
  onDraft: (next: string) => void;
  /** Clears the draft and closes — after something has run. */
  onDone: () => void;
  /** Replaces the draft with a chosen prompt and closes, leaving it unsent. */
  onInsert: (text: string) => void;
  /** The textarea keeps focus the whole time, so it — not this list — is what
   *  assistive technology is reading. It has to be told what is highlighted. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Lets the composer read the highlighted row on Enter. */
  controller: (api: PaletteApi | null) => void;
}

/** What the composer is allowed to ask the palette to do. Keyboard handling
 *  lives in the textarea, because that is where the events arrive; the palette
 *  owns the list, so it answers questions about the list. */
export interface PaletteApi {
  move: (delta: number) => void;
  /** Runs the highlighted row. Returns false if there was nothing to run, in
   *  which case the composer sends the draft as an ordinary message. */
  accept: () => boolean;
  /** Backs out of a confirmation or an option list. False if already at the
   *  top level, so Escape can fall through to closing the palette. */
  back: () => boolean;
}

export function CommandPalette({
  state,
  commands,
  onDraft,
  onDone,
  onInsert,
  inputRef,
  controller,
}: Props) {
  const [index, setIndex] = useState(0);
  const [options, setOptions] = useState<CommandOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<CommandOption | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const optionStage = state.stage === "option";
  const commandName = optionStage ? state.name : null;
  const activeCmd = commandName ? commands.find((c) => c.name === commandName) : null;

  /* For a `resolve` command the query IS the input, so it belongs in the
     dependency list. For an `options` command it must not be, or `/model`
     would refetch twenty-one models on every letter. Folding that difference
     into one key keeps it to a single effect with an honest dependency list,
     rather than two effects racing to set the same state. */
  const dynamic = !!activeCmd?.resolve;
  const resolveKey = dynamic ? state.query : "";

  useEffect(() => {
    if (!commandName) {
      setOptions(null);
      setConfirming(null);
      return;
    }
    const cmd = commands.find((c) => c.name === commandName);
    if (!cmd) return;

    let live = true;
    const load = cmd.resolve ? () => cmd.resolve!(resolveKey) : cmd.options;
    /* A `compute` command has nothing to load — its rows are worked out
       during render. Clearing the flag matters when it was entered straight
       from a list that was still loading, which would otherwise keep saying
       "Loading…" over rows that are already there. */
    if (!load) {
      setLoading(false);
      return;
    }

    setLoading(true);
    /* Debounced only for the dynamic case, where each run is a round trip
       triggered by a keystroke. A fixed list has nothing to debounce, and
       delaying it would just make the menu feel slow. */
    const go = () => {
      void Promise.resolve(load())
        .then((list) => live && setOptions(list))
        .catch(() => live && setOptions([]))
        .finally(() => live && setLoading(false));
    };
    if (!cmd.resolve) {
      go();
      return () => {
        live = false;
      };
    }
    const timer = window.setTimeout(go, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandName, resolveKey, dynamic]);

  const visibleCommands = filterByQuery(commands, state.query, (c) => c.name);
  /* A resolved list is already an answer to the query — filtering it by the
     same text would hide it, because "C:\Users" does not contain "c:/users".
     A computed one is too, for the same reason. */
  const computed = optionStage && activeCmd?.compute ? activeCmd.compute(state.query) : null;
  const visibleOptions = optionStage
    ? (computed ??
      (dynamic ? (options ?? []) : filterByQuery(options ?? [], state.query, (o) => o.label)))
    : [];
  const rows: Array<Command | CommandOption> = optionStage ? visibleOptions : visibleCommands;

  /* Highlight returns to the top whenever the list changes underneath it.
     Leaving it where it was would mean a row the user never looked at is armed
     for Enter — the sort of thing that runs the wrong command once and is
     never trusted again. */
  useEffect(() => setIndex(0), [state.query, state.stage, commandName, options]);

  /* Keep the highlighted row in view when arrowing past the visible edge. */
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);

  /* The combobox pattern, applied to a textarea this component does not own.
     Written as attributes rather than JSX props because the textarea belongs
     to the composer: it is a list over there and an input over here, and only
     the half that knows the list can describe it. The cleanup is what matters
     most — leave `aria-activedescendant` pointing at a row that no longer
     exists and the textarea becomes unreadable for the rest of the session. */
  const activeId = !confirming && rows[index] ? `palette-row-${index}` : null;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.setAttribute("role", "combobox");
    el.setAttribute("aria-expanded", "true");
    el.setAttribute("aria-controls", "palette-list");
    if (activeId) el.setAttribute("aria-activedescendant", activeId);
    else el.removeAttribute("aria-activedescendant");
    return () => {
      el.removeAttribute("role");
      el.removeAttribute("aria-expanded");
      el.removeAttribute("aria-controls");
      el.removeAttribute("aria-activedescendant");
    };
  }, [activeId, inputRef]);

  const runOption = (opt: CommandOption) => {
    if (opt.confirm && confirming?.value !== opt.value) {
      setConfirming(opt);
      return;
    }
    opt.run();
    /* An inserting row hands its text to the composer instead of clearing
       it: the template is the start of a message, and the user still has to
       paste in the part only they have. */
    if (opt.insert !== undefined) onInsert(opt.insert);
    else onDone();
  };

  /* Takes the row index explicitly instead of reading `index` from state.
     That is not a style choice — `onPointerDown` calls `setIndex(i)` and then
     runs a row in the same handler, and React has not re-rendered yet, so a
     version that read state would act on whatever was highlighted BEFORE the
     click. Clicking "Low" would quietly run "Model default". */
  const acceptAt = (i: number): boolean => {
    if (confirming) {
      confirming.run();
      onDone();
      return true;
    }
    const row = rows[i];
    if (!row) return false;

    if (optionStage) {
      const opt = row as CommandOption;
      /* A rejected path is still shown, so it is still selectable by the
         arrow keys — refusing here is what stops Enter from committing it. */
      if (opt.disabled) return true;
      runOption(opt);
      return true;
    }

    const cmd = row as Command;
    if (cmd.disabled) return true; // Consume the key; refusing is the answer.
    if (hasOptions(cmd)) {
      /* Advance the text rather than switching a mode flag. The draft is the
         state, so writing "/model " into it is what moves the palette on. */
      onDraft(`/${cmd.name} `);
      return true;
    }
    cmd.run?.();
    onDone();
    return true;
  };

  const accept = (): boolean => acceptAt(index);

  /* Published every render so the closure the composer calls always sees the
     current index and rows, rather than the ones captured on mount. */
  useEffect(() => {
    controller({
      move: (delta) => setIndex((i) => (rows.length ? (i + delta + rows.length) % rows.length : 0)),
      accept,
      back: () => {
        if (confirming) {
          setConfirming(null);
          return true;
        }
        if (optionStage) {
          onDraft(`/${state.stage === "option" ? state.name : ""}`);
          return true;
        }
        return false;
      },
    });
    return () => controller(null);
  });

  if (confirming) {
    return (
      <div className="palette palette--confirm" role="dialog" aria-label="Confirm">
        <p className="palette__confirm-title">
          <Icon name="alert" size={15} />
          {confirming.confirm}
        </p>
        <p className="palette__confirm-body">{confirming.hint}</p>
        <div className="palette__confirm-actions">
          <button className="btn btn--dark" onClick={() => accept()}>
            Yes, {confirming.label.toLowerCase()}
          </button>
          <button className="btn" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const active = optionStage ? activeCmd : null;

  return (
    <div className="palette" ref={listRef}>
      <div className="palette__head">
        {active ? (
          <>
            <span className="palette__crumb">/{active.name}</span>
            {/* A real space, not the flex gap. `gap` separates the boxes but
                leaves textContent as "/effortChoose an effort level", which is
                what a screen reader reads out and what a copy-paste captures. */}
            {" "}
            {active.optionPrompt}
          </>
        ) : (
          "Commands"
        )}
      </div>

      {loading && <p className="palette__empty">{dynamic ? "Checking…" : "Loading…"}</p>}

      {!loading && rows.length === 0 && (
        <p className="palette__empty">
          {optionStage ? "Nothing matches." : "No command matches — press Enter to send as a message."}
        </p>
      )}

      {/* The listbox is this element, not the panel: a listbox's children are
          supposed to be options, and the header and footer are not. */}
      <div className="palette__list" id="palette-list" role="listbox" aria-label="Commands">
        {rows.map((row, i) => {
          const isOption = optionStage;
          const cmd = row as Command;
          const opt = row as CommandOption;
          const key = isOption ? opt.value : cmd.name;
          const disabled = isOption ? opt.disabled : cmd.disabled;

          return (
            <button
              key={key}
              id={`palette-row-${i}`}
              className="palette__row"
              role="option"
              /* Two different states, and conflating them is the usual bug:
                 `aria-selected` is where the keyboard is right now,
                 `aria-checked` is the value actually in force. A screen reader
                 needs both to say "Claude Sonnet 5, checked, 3 of 21". */
              aria-selected={i === index}
              aria-checked={isOption ? !!opt.checked : undefined}
              aria-disabled={!!disabled}
              data-active={i === index}
              data-checked={isOption ? !!opt.checked : undefined}
              data-disabled={!!disabled}
              /* Pointer, not click: mousedown would blur the textarea and
                 close the palette before the click ever landed. */
              onPointerDown={(e) => {
                e.preventDefault();
                setIndex(i);
                if (!disabled) acceptAt(i);
              }}
              onPointerEnter={() => setIndex(i)}
            >
              <span className="palette__name">
                {isOption ? opt.label : `/${cmd.name}`}
                {isOption && opt.checked && <Icon name="check" size={14} />}
              </span>
              <span className="palette__hint">
                {disabled ? cmd.disabled : isOption ? opt.hint : cmd.hint}
              </span>
            </button>
          );
        })}
      </div>

      <div className="palette__foot">
        <kbd>↑</kbd>
        <kbd>↓</kbd> move
        <kbd>Enter</kbd> select
        <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
}
