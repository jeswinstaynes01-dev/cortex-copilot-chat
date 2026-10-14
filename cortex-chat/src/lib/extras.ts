/**
 * extras.ts — the CLI commands the runtime does not list as slash commands.
 *
 * /agent, /rewind, /tasks, /instructions and /version are CLI features built
 * on separate runtime calls, so the backend serves each from its own endpoint
 * (see CommandController). This module names them for the palette and turns
 * each endpoint's JSON into the markdown shown in the reply bubble. The
 * formatters are pure, so they are tested without a backend.
 */

import type { RuntimeCommand } from "./types";

const extra = (name: string, description: string, hint: string | null = null): RuntimeCommand => ({
  name,
  aliases: [],
  description,
  hint,
  required: false,
  choices: [],
  kind: "cortex",
  allowDuringTurn: false,
  confirm: false,
});

export const EXTRA_COMMANDS: RuntimeCommand[] = [
  extra("agent", "List custom agents, or switch to one", "[name | default]"),
  extra("rewind", "List earlier prompts, or make the agent forget from one onwards", "[number]"),
  extra("tasks", "List background tasks, or cancel one", "[cancel <id>]"),
  extra("schedules", "List prompts scheduled by /every and /after, or stop one", "[stop <id>]"),
  extra("instructions", "Show the instruction files in effect"),
  extra("version", "Show the Cortex, SDK, CLI and Java versions"),
  extra("help", "List every slash command"),
];

/** Cortex's own commands, for /help. A test keeps this in step with buildCommands. */
export const NATIVE_COMMAND_NAMES = [
  "new", "model", "effort", "persona", "resume", "cd", "thinking", "approve",
  "prompt", "save", "unsave", "copy", "export", "stop",
];

type Json = Record<string, unknown>;
const rec = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined;
const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.map(rec) : []);
const oneLine = (s: string, max = 90): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const when = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
};

export function formatAgents(v: unknown): string {
  const o = rec(v);
  const current = str(o.current);
  const agents = rows(o.agents);
  if (!agents.length) return "No custom agents are available in this session.";
  const lines = agents.map((a) => {
    const name = str(a.name) ?? "?";
    const about = str(a.description);
    const mark = name === current ? " **(current)**" : "";
    return `- \`/agent ${name}\`${mark} — ${str(a.displayName) ?? name}${about ? `: ${oneLine(about)}` : ""}`;
  });
  return [
    `Current agent: **${current ?? "default"}**`,
    "",
    ...lines,
    "",
    "`/agent default` goes back to the default agent.",
  ].join("\n");
}

export function formatRewindPoints(v: unknown): string {
  const o = rec(v);
  if (o.available === false) {
    return `Rewind isn't available in this session${str(o.reason) ? ` (${str(o.reason)})` : ""}.`;
  }
  const points = rows(o.points);
  if (!points.length) return "Nothing to rewind to yet. Send a message first.";
  return [
    "Rewinding makes the agent forget that prompt and everything after it. Files on disk are left alone.",
    "",
    ...points.map((p, i) => {
      const at = str(p.timestamp);
      return `${i + 1}. \`/rewind ${i + 1}\` — ${oneLine(str(p.userMessage) ?? "(no text)")}${at ? ` · ${when(at)}` : ""}`;
    }),
  ].join("\n");
}

export function formatTasks(v: unknown): string {
  const tasks = rows(v);
  if (!tasks.length) return "No background tasks are running.";
  return [
    ...tasks.map((t) => {
      const id = str(t.id) ?? str(t.taskId) ?? "?";
      const meta = [str(t.status), str(t.type) ?? str(t.kind)].filter(Boolean).join(" · ");
      const about = str(t.description) ?? str(t.title) ?? str(t.command) ?? str(t.prompt);
      return `- \`${id}\`${meta ? ` · ${meta}` : ""}${about ? ` — ${oneLine(about)}` : ""}`;
    }),
    "",
    "Cancel one with `/tasks cancel <id>`.",
  ].join("\n");
}

export function formatSchedules(v: unknown): string {
  const entries = rows(v);
  if (!entries.length) return "No prompts are scheduled. Add one with `/every` or `/after`.";
  return [
    ...entries.map((e) => {
      const ms = typeof e.intervalMs === "number" ? e.intervalMs : null;
      const cadence = ms
        ? `every ${ms % 60000 === 0 ? `${ms / 60000}m` : `${Math.round(ms / 1000)}s`}`
        : str(e.cron)
          ? `cron ${str(e.cron)}`
          : str(e.at)
            ? `at ${when(str(e.at)!)}`
            : e.recurring === true
              ? "recurring"
              : "once";
      const next = str(e.nextRunAt);
      const prompt = str(e.displayPrompt) ?? str(e.prompt) ?? "";
      return `- **#${str(e.id) ?? "?"}** · ${cadence}${next ? ` · next ${when(next)}` : ""} — ${oneLine(prompt)}`;
    }),
    "",
    "Stop one with `/schedules stop <id>`.",
  ].join("\n");
}

export function formatInstructions(v: unknown): string {
  const sources = rows(v);
  if (!sources.length) return "No instruction files are in effect.";
  return sources
    .map((s) => {
      const where = [str(s.location), str(s.type)].filter(Boolean).join(" / ");
      const applyTo = Array.isArray(s.applyTo) ? s.applyTo.filter((x) => typeof x === "string") : [];
      const parts = [
        str(s.sourcePath) ? `\`${str(s.sourcePath)}\`` : null,
        applyTo.length ? `applies to ${applyTo.join(", ")}` : null,
        typeof s.chars === "number" ? `${s.chars.toLocaleString()} chars` : null,
        s.defaultDisabled === true ? "off by default" : null,
      ].filter(Boolean);
      return `- **${str(s.label) ?? str(s.id) ?? "instructions"}**${where ? ` (${where})` : ""}${parts.length ? ` — ${parts.join(" · ")}` : ""}`;
    })
    .join("\n");
}

export function formatVersion(v: unknown): string {
  const o = rec(v);
  const app = rec(o.app);
  const cli = rec(o.cli);
  const cliText = str(cli.error)
    ? `unavailable (${str(cli.error)})`
    : `${str(cli.version) ?? "?"}${str(cli.protocolVersion) ? ` (protocol ${str(cli.protocolVersion)})` : ""}`;
  return [
    `- **${str(app.name) ?? "Cortex"}** ${str(app.version) ?? "?"}`,
    `- **Copilot SDK for Java** ${str(rec(o.sdk).version) ?? "?"}`,
    `- **Copilot CLI** ${cliText}`,
    `- **Java** ${str(o.java) ?? "?"}`,
  ].join("\n");
}

export function formatHelp(runtime: RuntimeCommand[]): string {
  const line = (c: RuntimeCommand) =>
    `- \`/${c.name}${c.hint ? ` ${c.hint}` : ""}\`${c.description ? ` — ${oneLine(c.description)}` : ""}`;
  const builtins = runtime.filter((c) => c.kind !== "skill" && c.kind !== "cortex");
  const skills = runtime.filter((c) => c.kind === "skill");
  return [
    `**Cortex:** ${NATIVE_COMMAND_NAMES.map((n) => `\`/${n}\``).join(" ")} — type \`/\` to see what each does.`,
    "",
    "**Copilot runtime**",
    ...builtins.map(line),
    ...(skills.length ? ["", "**Skills**", ...skills.map(line)] : []),
    "",
    "**Session tools**",
    ...EXTRA_COMMANDS.map(line),
  ].join("\n");
}
