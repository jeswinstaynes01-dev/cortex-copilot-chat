import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commands";
import { buildCommands } from "./commands";
import { describeCommandResult } from "./copilotClient";
import { NATIVE_COMMAND_NAMES } from "./extras";
import type { RuntimeCommand } from "./types";

const runtime = (over: Partial<RuntimeCommand>): RuntimeCommand => ({
  name: "context",
  aliases: [],
  description: "Show context usage",
  hint: null,
  required: false,
  choices: [],
  kind: "builtin",
  allowDuringTurn: true,
  confirm: false,
  ...over,
});

function context(over: Partial<CommandContext> = {}): CommandContext {
  return {
    busy: false,
    settings: null,
    conversation: null,
    conversations: [],
    showReasoning: false,
    loadModels: async () => [],
    personas: null,
    prompts: [],
    savedPrompts: [],
    lastUserMessage: null,
    checkDirectory: async () => ({ ok: false, resolved: null, error: null }),
    onNewChat: vi.fn(),
    onOpenChat: vi.fn(),
    onStop: vi.fn(),
    onConfigure: vi.fn(),
    onToggleReasoning: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn(),
    onSavePrompt: vi.fn(),
    onDeletePrompt: vi.fn(),
    ...over,
  };
}

describe("runtime commands in the palette", () => {
  it("are appended after the natives, which win a name clash", () => {
    const send = vi.fn();
    const list = buildCommands(
      context({
        runtimeCommands: [runtime({}), runtime({ name: "model", description: "runtime model" })],
        onRunCommand: send,
      }),
    );
    expect(list.filter((c) => c.name === "model")).toHaveLength(1);
    expect(list.find((c) => c.name === "model")!.hint).not.toBe("runtime model");
    const ctx = list.find((c) => c.name === "context")!;
    expect(ctx.disabled).toBeNull();
    ctx.run!();
    expect(send).toHaveBeenCalledWith("/context");
  });

  it("offer choices as options and free input as a computed row", async () => {
    const send = vi.fn();
    const list = buildCommands(
      context({
        runtimeCommands: [
          runtime({ name: "theme", choices: [{ name: "dark", description: null }] }),
          runtime({ name: "every", hint: "<interval> <prompt>", required: true }),
        ],
        onRunCommand: send,
      }),
    );
    const [dark] = await list.find((c) => c.name === "theme")!.options!();
    dark.run();
    expect(send).toHaveBeenCalledWith("/theme dark");

    const every = list.find((c) => c.name === "every")!;
    expect(every.compute!("")[0].disabled).toMatch(/Type/);
    every.compute!(" 5m check the build ")[0].run();
    expect(send).toHaveBeenLastCalledWith("/every 5m check the build");
  });

  it("are refused while a reply is streaming, and absent without a sender", () => {
    const busy = buildCommands(context({ busy: true, runtimeCommands: [runtime({})], onRunCommand: vi.fn() }));
    expect(busy.find((c) => c.name === "context")!.disabled).toMatch(/Wait/);
    const none = buildCommands(context({ runtimeCommands: [runtime({})] }));
    expect(none.some((c) => c.name === "context")).toBe(false);
  });

  it("/help names exactly Cortex's own commands", () => {
    expect(buildCommands(context()).map((c) => c.name)).toEqual(NATIVE_COMMAND_NAMES);
  });
});

describe("describeCommandResult", () => {
  it("fences plain text and passes markdown through", () => {
    expect(describeCommandResult({ type: "x", kind: "text", text: "a\nb", markdown: false }).text).toBe(
      "````text\na\nb\n````",
    );
    expect(describeCommandResult({ type: "x", kind: "text", text: "**hi**", markdown: true }).text).toBe(
      "**hi**",
    );
  });

  it("lists a select result as runnable commands", () => {
    const out = describeCommandResult({
      type: "x",
      kind: "select",
      command: "agent",
      title: "Pick an agent",
      options: [{ name: "explore", description: "Read-only" }, { name: "" }],
    });
    expect(out.text).toBe("Pick an agent\n\n- `/agent explore` — Read-only");
  });

  it("reports errors and turn notices", () => {
    expect(describeCommandResult({ type: "x", kind: "error", command: "fleet", error: "No" }).error).toBe("No");
    expect(describeCommandResult({ type: "x", kind: "turn", notice: "Plan mode on" }).notice).toBe(
      "Plan mode on",
    );
    expect(describeCommandResult({ type: "x", kind: "completed", message: "" }).text).toBe("Done.");
  });
});
