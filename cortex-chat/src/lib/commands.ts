/**
 * commands.ts — the `/` command registry and the parser that drives it.
 *
 * WHAT A COMMAND IS ALLOWED TO BE
 *
 * The same rule the rest of this project runs on: a command exists only if
 * something behind it genuinely does the work. There is no `/search`, because
 * the agent decides for itself when to search; no `/attach`, because there is
 * no upload endpoint; no `/clear`, because deleting a chat and starting a new
 * one are two different things and conflating them would destroy a transcript
 * someone meant to keep. Every entry below maps to a function App already
 * calls from a button somewhere — the palette is keyboard access to the
 * existing surface, not a second, parallel feature set.
 *
 * It also refuses to pretend. A command that cannot run right now says why
 * (`/stop` with nothing running, `/effort` on a model that has no effort
 * levels) instead of vanishing or failing silently when chosen. A disabled row
 * with a reason teaches the interface; a missing row teaches nothing.
 *
 * TWO SHAPES OF COMMAND
 *
 *   run()      does the thing immediately.          `/new`, `/stop`
 *   options()  offers a second list to pick from.   `/model`, `/effort`
 *
 * Nothing needs both, and keeping them mutually exclusive means the palette
 * never has to guess which it is looking at. The second list can come from
 * three places — `options` fetched once, `resolve` re-checked against the
 * server as you type, `compute` worked out on the spot from the typing — but
 * by the time the palette sees it, it is just rows.
 *
 * A row normally runs something. A row with `insert` runs nothing: it puts
 * text into the composer, which is how `/prompt` hands over a template for the
 * user to finish rather than sending half a question.
 */

import type { ClientSettings, Conversation, ModelOption, Persona, RuntimeCommand } from "./types";
import type { Prompt } from "./prompts";
import { defaultPromptName, findSavedPrompt } from "./prompts";
import { EFFORT_DEFAULT_HINT, EFFORT_DEFAULT_LABEL, effortHint, effortLabel } from "./effort";

export interface CommandOption {
  /** Stable identity, used for React keys and for the harness to click one. */
  value: string;
  label: string;
  hint?: string;
  /** Marks the value currently in force, so the list doubles as a readout. */
  checked?: boolean;
  /** Non-null means this option cannot be chosen, and the string is why.
   *  Used by `/cd` to show a rejected path together with the server's reason
   *  instead of an empty list that says nothing. */
  disabled?: string | null;
  /** When set, choosing this option asks this question before doing anything.
   *  Reserved for choices that hand something away — currently only granting
   *  the agent unsupervised shell access. */
  confirm?: string;
  /** When set, choosing this option replaces the draft with this text and
   *  leaves it there, unsent, instead of clearing the draft after `run`. */
  insert?: string;
  run: () => void;
}

export interface Command {
  name: string;
  /** One line, present tense, describing what happens. Shown beside the name. */
  hint: string;
  /** Non-null means "cannot run now", and the string is the reason shown to
   *  the user. Null means available. */
  disabled: string | null;
  run?: () => void;
  /** A fixed list, fetched once when the command is entered. */
  options?: () => CommandOption[] | Promise<CommandOption[]>;
  /** A list computed from what is being typed, re-run (debounced) as it
   *  changes. Separate from `options` because the two have opposite caching
   *  needs: `/model` must NOT refetch twenty-one models per keystroke, and
   *  `/cd` MUST re-check, because the query is the thing being validated. */
  resolve?: (query: string) => Promise<CommandOption[]>;
  /** A list worked out synchronously from what is being typed, with no
   *  round trip to wait for — `/save`, whose one row is the name the typing
   *  would save under. Synchronous on purpose: a debounced answer would leave
   *  Enter, pressed straight after typing the name, acting on the row for the
   *  name as it was 220 ms earlier. Shown as returned, never filtered. */
  compute?: (query: string) => CommandOption[];
  /** Placeholder shown while picking an option, e.g. "Search models". */
  optionPrompt?: string;
}

/* ------------------------------------------------------------------------
   Parsing the draft
   ------------------------------------------------------------------------ */

export type SlashState =
  /** Choosing which command to run. `query` is what has been typed after "/". */
  | { stage: "command"; query: string }
  /** A command with options is chosen; `query` filters its option list. */
  | { stage: "option"; name: string; query: string };

/**
 * Decides whether the draft is currently a command, and which stage it is in.
 *
 * Returns null — meaning "this is an ordinary message" — for anything with a
 * newline, because a multi-line draft is prose. That also provides the escape
 * hatch for genuinely wanting to send text that starts with a slash: a path,
 * a regex, a closing HTML tag. If it matches no command the palette shows
 * nothing selectable and Enter sends it verbatim, so no message is ever
 * swallowed by a feature the user was not using.
 */
export function parseSlash(draft: string, commands: Command[]): SlashState | null {
  if (!draft.startsWith("/") || draft.includes("\n")) return null;

  const body = draft.slice(1);
  const space = body.indexOf(" ");
  if (space === -1) return { stage: "command", query: body };

  /* There is a space, so the first word is settled. It only moves the palette
     on to the option stage if it names a real command that HAS options —
     otherwise "/new york" is just a message that happens to start with "/new"
     and should keep filtering commands (and matching none of them). */
  const name = body.slice(0, space).toLowerCase();
  const cmd = commands.find((c) => c.name === name);
  if (cmd && hasOptions(cmd) && !cmd.disabled) {
    return { stage: "option", name, query: body.slice(space + 1) };
  }
  return { stage: "command", query: body };
}

/** True for a command that leads to a second list rather than running. */
export function hasOptions(cmd: Command): boolean {
  return !!(cmd.options || cmd.resolve || cmd.compute);
}

/**
 * Ranks a list against a query. Prefix matches beat interior ones, so typing
 * "mo" puts `/model` above `/common`, which is what anyone typing two letters
 * and pressing Enter expects. An empty query keeps the registry's own order,
 * which is arranged by how often each command is likely to be wanted.
 */
export function filterByQuery<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items
    .map((item, index) => {
      const at = text(item).toLowerCase().indexOf(q);
      return { item, index, at };
    })
    .filter((r) => r.at !== -1)
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((r) => r.item);
}

/* ------------------------------------------------------------------------
   The registry
   ------------------------------------------------------------------------ */

export interface CommandContext {
  busy: boolean;
  settings: ClientSettings | null;
  conversation: Conversation | null;
  /** Live chats that can be reopened, newest first. */
  conversations: Conversation[];
  showReasoning: boolean;
  loadModels: () => Promise<ModelOption[]>;
  /** Null until the backend has answered; empty when it offers none. */
  personas: Persona[] | null;
  /** Built-ins first, then the user's saved prompts. */
  prompts: Prompt[];
  /** Only the saved ones — the only ones `/save` can replace or `/unsave` remove. */
  savedPrompts: Prompt[];
  /** The last thing the user sent in the chat on screen, for `/save`. */
  lastUserMessage: string | null;
  checkDirectory: (path: string) => Promise<{
    ok: boolean;
    resolved: string | null;
    error: string | null;
  }>;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onStop: () => void;
  onConfigure: (patch: Partial<ClientSettings>) => void;
  onToggleReasoning: () => void;
  onCopy: () => void;
  onExport: () => void;
  onSavePrompt: (name: string, text: string) => void;
  onDeletePrompt: (id: string) => void;
  /** The Copilot runtime's own commands (/context, /review, skills…). */
  runtimeCommands?: RuntimeCommand[];
  /** Sends "/name input"; the client routes it to the runtime, not the agent. */
  onRunCommand?: (text: string) => void;
}

/** Appended to anything that drops the current agent session. The user is
 *  always told before choosing, never after. */
const RESTARTS = "Starts a new agent session.";

export function buildCommands(ctx: CommandContext): Command[] {
  const hasMessages = (ctx.conversation?.messages.length ?? 0) > 0;

  const natives: Command[] = [
    {
      name: "new",
      hint: "Start a fresh chat",
      disabled: null,
      run: ctx.onNewChat,
    },

    {
      name: "model",
      hint: `Switch the model. ${RESTARTS}`,
      optionPrompt: "Search models",
      disabled: null,
      options: async () => {
        const models = await ctx.loadModels();
        return models.map((m) => ({
          value: m.id,
          label: m.name,
          /* Say what each model can do rather than repeating its name. The
             effort list is the one fact that differs usefully between them
             and is not guessable from the title. */
          hint: m.reasoningEfforts.length
            ? `Reasoning: ${m.reasoningEfforts.map(effortLabel).join(", ")}`
            : "No reasoning-effort setting",
          checked: m.id === ctx.settings?.model,
          run: () => ctx.onConfigure({ model: m.id }),
        }));
      },
    },

    {
      name: "effort",
      hint: `Set how hard the model thinks. ${RESTARTS}`,
      optionPrompt: "Choose an effort level",
      /* Resolved against the CURRENT model, because effort support is per
         model and not a scale. Saying so up front is the difference between a
         control that is unavailable and one that appears broken. */
      disabled: effortAvailability(ctx),
      options: async () => {
        const models = await ctx.loadModels();
        const current = models.find((m) => m.id === ctx.settings?.model);
        const levels = current?.reasoningEfforts ?? [];
        return [
          {
            value: "__default__",
            label: EFFORT_DEFAULT_LABEL,
            hint: EFFORT_DEFAULT_HINT,
            checked: ctx.settings?.reasoningEffort == null,
            run: () => ctx.onConfigure({ reasoningEffort: null }),
          },
          ...levels.map((level) => ({
            value: level,
            label: effortLabel(level),
            hint: effortHint(level),
            checked: ctx.settings?.reasoningEffort === level,
            run: () => ctx.onConfigure({ reasoningEffort: level }),
          })),
        ];
      },
    },

    {
      name: "persona",
      hint: `Give the agent a role. ${RESTARTS}`,
      optionPrompt: "Choose a persona",
      disabled: personaAvailability(ctx),
      options: () => [
        {
          value: "__none__",
          label: "None",
          hint: "No role — the agent's own instructions only",
          checked: ctx.settings?.persona == null,
          run: () => ctx.onConfigure({ persona: null }),
        },
        ...(ctx.personas ?? []).map((p) => ({
          value: p.id,
          label: p.name,
          hint: p.description,
          checked: ctx.settings?.persona === p.id,
          run: () => ctx.onConfigure({ persona: p.id }),
        })),
      ],
    },

    {
      name: "resume",
      hint: "Reopen an earlier chat",
      optionPrompt: "Search chats",
      disabled: ctx.conversations.length ? null : "No earlier chats yet",
      options: () =>
        ctx.conversations.map((c) => ({
          value: c.id,
          label: c.title,
          hint: `${c.messages.length} message${c.messages.length === 1 ? "" : "s"}`,
          checked: c.id === ctx.conversation?.id,
          run: () => ctx.onOpenChat(c.id),
        })),
    },

    {
      name: "cd",
      hint: `Change the agent's working directory. ${RESTARTS}`,
      optionPrompt: "Type a folder path",
      disabled: null,
      /* The only command whose argument is typed rather than chosen, which is
         exactly why it is also the only one that has to be checked before it
         is accepted. Session settings are fixed at creation, so an unchecked
         typo would be taken happily and then fail on the next message — with
         the message already typed and gone. */
      resolve: async (query) => {
        const typed = query.trim();
        const currentDir = ctx.settings?.workingDirectory ?? "";

        if (!typed) {
          return [
            {
              value: "__current__",
              label: currentDir || "No working directory set",
              hint: "Current folder",
              checked: !!currentDir,
              disabled: "Type a path to change it",
              run: () => {},
            },
          ];
        }

        const res = await ctx.checkDirectory(typed);
        if (!res.ok || !res.resolved) {
          return [
            {
              value: "__rejected__",
              label: typed,
              hint: res.error ?? "Not a folder",
              disabled: res.error ?? "Not a folder",
              run: () => {},
            },
          ];
        }

        /* The label is the RESOLVED path, not what was typed. Entering ".."
           or a relative name and seeing the absolute folder it means is the
           whole point of checking: you approve the thing that will actually
           happen, not the shorthand for it. */
        const same = res.resolved.toLowerCase() === currentDir.toLowerCase();
        return [
          {
            value: res.resolved,
            label: res.resolved,
            hint: same ? "Already the working directory" : RESTARTS,
            checked: same,
            disabled: same ? "Already the working directory" : null,
            run: () => ctx.onConfigure({ workingDirectory: res.resolved as string }),
          },
        ];
      },
    },

    {
      name: "thinking",
      hint: ctx.showReasoning ? "Hide the agent's reasoning" : "Show the agent's reasoning",
      disabled: null,
      run: ctx.onToggleReasoning,
    },

    {
      name: "approve",
      hint: "Auto-approve tool calls",
      optionPrompt: "Auto-approve tool calls",
      disabled: null,
      options: () => [
        {
          value: "on",
          label: "Turn on",
          hint: "Run file and shell actions without asking first.",
          checked: ctx.settings?.autoApprove === true,
          /* The only confirmation in the palette. Everything else here is
             reversible by running the command again; this one hands the agent
             unsupervised shell access on a real machine, and a mistyped "/a"
             followed by Enter should not be enough to do that. The switch in
             the model menu asks the same question for the same reason. */
          confirm:
            "Let the agent run file and shell commands without asking you first?",
          run: () => ctx.onConfigure({ autoApprove: true }),
        },
        {
          value: "off",
          label: "Turn off",
          hint: "Ask before every file or shell action.",
          checked: ctx.settings?.autoApprove === false,
          run: () => ctx.onConfigure({ autoApprove: false }),
        },
      ],
    },

    {
      name: "prompt",
      hint: "Insert a prompt template to fill in",
      optionPrompt: "Search prompts",
      disabled: null,
      /* Inserted, never sent: each one is a template that ends where the
         user's own material starts. See prompts.ts. */
      options: () =>
        ctx.prompts.map((p) => ({
          value: p.id,
          label: p.name,
          hint: p.builtIn ? "Built-in" : "Saved",
          insert: p.text,
          run: () => {},
        })),
    },

    {
      name: "save",
      hint: "Save your last message as a reusable prompt",
      optionPrompt: "Name it, or press Enter",
      disabled: ctx.lastUserMessage ? null : "Nothing to save yet — send a message first",
      /* One row, rebuilt as the name is typed, so what Enter will do is
         always on screen before it happens — including that it will
         overwrite an existing prompt of the same name. */
      compute: (query) => {
        const text = ctx.lastUserMessage;
        if (!text) return [];
        const name = query.trim() || defaultPromptName(text);
        const replaces = findSavedPrompt(ctx.savedPrompts, name);
        return [
          {
            value: "__save__",
            label: `Save as “${name}”`,
            hint: replaces ? "Replaces the saved prompt with this name" : "Reuse it any time from /prompt",
            run: () => ctx.onSavePrompt(name, text),
          },
        ];
      },
    },

    {
      name: "unsave",
      hint: "Delete a saved prompt",
      optionPrompt: "Choose a prompt to delete",
      disabled: ctx.savedPrompts.length ? null : "No saved prompts yet",
      options: () =>
        ctx.savedPrompts.map((p) => {
          const preview = defaultPromptName(p.text);
          return {
            value: p.id,
            label: p.name,
            /* The opening words tell two similar names apart — unless the
               name already IS the opening words, which is the default. */
            hint: preview === p.name ? "Saved prompt" : preview,
            run: () => ctx.onDeletePrompt(p.id),
          };
        }),
    },

    {
      name: "copy",
      hint: "Copy this chat as Markdown",
      disabled: hasMessages ? null : "Nothing to copy yet",
      run: ctx.onCopy,
    },

    {
      name: "export",
      hint: "Download this chat as a .md file",
      disabled: hasMessages ? null : "Nothing to export yet",
      run: ctx.onExport,
    },

    {
      name: "stop",
      hint: "Interrupt the agent",
      disabled: ctx.busy ? null : "The agent isn't working right now",
      run: ctx.onStop,
    },
  ];
  return [...natives, ...runtimeEntries(ctx, natives)];
}

/* The runtime's own commands, listed after Cortex's. A native of the same name
   wins, because it is the one wired to this UI's buttons. Each runs by sending
   "/name input", which the client hands to the backend's command endpoint. */
function runtimeEntries(ctx: CommandContext, natives: Command[]): Command[] {
  const send = ctx.onRunCommand;
  if (!send || !ctx.runtimeCommands?.length) return [];
  const taken = new Set(natives.map((c) => c.name));
  return ctx.runtimeCommands
    .filter((rc) => !taken.has(rc.name))
    .map((rc): Command => {
      const base = {
        name: rc.name,
        hint: rc.description || rc.hint || "Copilot runtime command",
        /* One reply at a time: useChat refuses to send while the agent works. */
        disabled: ctx.busy ? "Wait for the reply to finish" : null,
      };
      if (rc.choices.length) {
        return {
          ...base,
          options: () =>
            rc.choices.map((c) => ({
              value: c.name,
              label: c.name,
              hint: c.description ?? undefined,
              run: () => send(`/${rc.name} ${c.name}`),
            })),
        };
      }
      if (!rc.hint) return { ...base, run: () => send(`/${rc.name}`) };
      const hint = rc.hint;
      return {
        ...base,
        optionPrompt: hint,
        compute: (query) => {
          const input = query.trim();
          return [
            {
              value: `run:${input}`,
              label: input ? `/${rc.name} ${input}` : `/${rc.name} ${hint}`,
              hint: rc.description,
              disabled: rc.required && !input ? `Type ${hint} first` : null,
              run: () => send(input ? `/${rc.name} ${input}` : `/${rc.name}`),
            },
          ];
        },
      };
    });
}

/** Why `/effort` cannot be used, or null if it can.
 *
 *  Three genuinely different situations, and collapsing them into one message
 *  would leave the user guessing which applied:
 *    - no settings yet: nothing is known about the model at all
 *    - "auto": the model is chosen per request, so there is nothing to set it on
 *    - a fixed model that simply has no levels
 *  The third cannot be decided here — it needs the model list, which is async —
 *  so the option list handles it by coming back with only "Model default". */
function effortAvailability(ctx: CommandContext): string | null {
  if (!ctx.settings) return "Still connecting";
  if (ctx.settings.model === "auto")
    return "Auto picks a model per request, so effort can't be set ahead of time";
  return null;
}

/** Why `/persona` cannot be used, or null if it can. An empty list is the
 *  backend's configuration, not a fault, so it says where personas come from. */
function personaAvailability(ctx: CommandContext): string | null {
  if (!ctx.settings || ctx.personas === null) return "Still connecting";
  if (!ctx.personas.length) return "No personas are configured on the backend";
  return null;
}
