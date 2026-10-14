import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotClient } from "./copilotClient";
import {
  formatAgents,
  formatHelp,
  formatInstructions,
  formatRewindPoints,
  formatSchedules,
  formatVersion,
  EXTRA_COMMANDS,
} from "./extras";
import type { Delta } from "./types";

describe("extras formatters", () => {
  it("mark the current agent and say how to go back", () => {
    const out = formatAgents({
      current: "explore",
      agents: [{ name: "explore", displayName: "Explore", description: "Read-only" }],
    });
    expect(out).toContain("Current agent: **explore**");
    expect(out).toContain("- `/agent explore` **(current)** — Explore: Read-only");
    expect(formatAgents({ agents: [] })).toMatch(/No custom agents/);
  });

  it("number rewind points as runnable commands", () => {
    const out = formatRewindPoints({
      available: true,
      points: [{ eventId: "e1", userMessage: "first\nprompt" }, { eventId: "e2", userMessage: "second" }],
    });
    expect(out).toContain("1. `/rewind 1` — first prompt");
    expect(out).toContain("2. `/rewind 2` — second");
    expect(formatRewindPoints({ available: false, reason: "no-history" })).toMatch(/no-history/);
    expect(formatRewindPoints({ available: true, points: [] })).toMatch(/Nothing to rewind/);
  });

  it("describe schedules, instructions and versions", () => {
    expect(formatSchedules([{ id: 3, intervalMs: 300000, prompt: "check the build" }])).toContain(
      "- **#3** · every 5m — check the build",
    );
    expect(formatSchedules([])).toMatch(/No prompts are scheduled/);
    expect(
      formatInstructions([
        { label: "Repo", location: "repository", type: "repo", sourcePath: ".github/x.md", applyTo: ["**/*.ts"], chars: 1200 },
      ]),
    ).toMatch(/\*\*Repo\*\* \(repository \/ repo\) — `\.github\/x\.md` · applies to \*\*\/\*\.ts · 1[,.]?200 chars/);
    const version = formatVersion({
      app: { name: "Cortex", version: "dev" },
      sdk: { version: "1.0.16" },
      cli: { version: "1.0.97", protocolVersion: 3 },
      java: "17",
    });
    expect(version).toContain("**Copilot CLI** 1.0.97 (protocol 3)");
  });

  it("help lists natives, runtime commands, skills and session tools", () => {
    const out = formatHelp([
      { name: "context", aliases: [], description: "Show context", hint: null, required: false, choices: [], kind: "builtin", allowDuringTurn: true, confirm: false },
      { name: "sql-optimization", aliases: [], description: "Tune SQL", hint: null, required: false, choices: [], kind: "skill", allowDuringTurn: false, confirm: false },
    ]);
    expect(out).toContain("`/new`");
    expect(out).toContain("- `/context` — Show context");
    expect(out).toContain("**Skills**");
    expect(out).toContain("- `/rewind [number]`");
  });
});

/* A stand-in for the browser's EventSource that lets a test push frames. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listener: ((e: { data: string }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  addEventListener(_type: string, fn: (e: { data: string }) => void) {
    this.listener = fn;
  }
  close() {}
  fire(frame: Record<string, unknown>) {
    this.listener?.({ data: JSON.stringify(frame) });
  }
}

const respond = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
  json: async () => body,
});

describe("copilotClient extras and scheduled turns", () => {
  let calls: Array<{ url: string; method: string }>;

  beforeEach(() => {
    calls = [];
    FakeEventSource.last = null;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        if (url === "/api/config") return respond({ defaultModel: "auto", models: [], personas: [] });
        if (url === "/api/sessions" && method === "GET") return respond([{ id: "s1" }]);
        if (url === "/api/sessions" && method === "POST") return respond({ id: "s1", reasoningEffort: null, persona: null });
        if (url === "/api/version") return respond({ app: { name: "Cortex", version: "dev" }, cli: { version: "1.0.97" } });
        if (url === "/api/sessions/s1/schedules/7/stop") return respond({ stopped: true, id: 7 });
        return respond(undefined);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const run = (text: string) =>
    new Promise<Delta[]>((resolve) => {
      const client = createCopilotClient();
      const seen: Delta[] = [];
      client.send({ text, history: [] }, (d) => {
        seen.push(d);
        if (d.type === "done" || d.type === "error") resolve(seen);
      });
    });

  it("answers /version from the backend without messaging the agent", async () => {
    const deltas = await run("/version");
    expect(deltas.map((d) => d.type)).toEqual(["text", "done"]);
    expect((deltas[0] as { value: string }).value).toContain("**Copilot CLI** 1.0.97");
    expect(calls.some((c) => c.url.endsWith("/messages"))).toBe(false);
  });

  it("stops a schedule, and refuses a schedule id that is not a number", async () => {
    expect((await run("/schedules stop #7")).map((d) => d.type)).toEqual(["text", "done"]);
    expect(calls).toContainEqual({ url: "/api/sessions/s1/schedules/7/stop", method: "POST" });
    const bad = await run("/schedules stop soon");
    expect(bad.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/number/) });
  });

  it("shows a scheduled turn once, streams it, and ends it on its own turn_end", async () => {
    const client = createCopilotClient();
    expect(await client.resume("s1")).toBe(true);
    const es = FakeEventSource.last!;
    const deltas: Delta[] = [];
    const handler = vi.fn(() => (d: Delta) => void deltas.push(d));
    client.onExternalTurn(handler);

    es.fire({ type: "dashboard.turn_start", external: true, turnId: "t1", content: "check the build", timestamp: Date.now() });
    es.fire({ type: "assistant.message_delta", data: { deltaContent: "All green" } });
    es.fire({ type: "dashboard.turn_end", requestId: "someone-else" });
    es.fire({ type: "dashboard.turn_end", external: true, turnId: "t1" });

    expect(handler).toHaveBeenCalledWith("check the build", expect.any(Function));
    expect(deltas.map((d) => d.type)).toEqual(["notice", "text", "done"]);

    es.fire({ type: "dashboard.turn_start", external: true, turnId: "t1", content: "again", timestamp: Date.now() });
    es.fire({ type: "dashboard.turn_start", external: true, turnId: "t0", content: "old", timestamp: Date.now() - 60_000 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(EXTRA_COMMANDS.map((c) => c.name)).toContain("rewind");
  });
});
