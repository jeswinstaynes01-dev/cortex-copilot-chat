import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "./commands";
import { buildCommands, filterByQuery, hasOptions, parseSlash } from "./commands";
import { BUILT_IN_PROMPTS } from "./prompts";
import type { Prompt } from "./prompts";
import type { ClientSettings, Persona } from "./types";

const SETTINGS: ClientSettings = {
  model: "gpt-5",
  autoApprove: false,
  workingDirectory: "C:\\work",
  reasoningEffort: null,
  persona: null,
};

const PERSONAS: Persona[] = [
  { id: "qa-engineer", name: "QA Engineer", description: "Thinks in test cases." },
  { id: "code-reviewer", name: "Code Reviewer", description: "Reviews like a senior." },
];

const SAVED: Prompt = { id: "saved:1", name: "Smoke pass", text: "Run a smoke pass over checkout", builtIn: false };

function context(over: Partial<CommandContext> = {}): CommandContext {
  return {
    busy: false,
    settings: SETTINGS,
    conversation: null,
    conversations: [],
    showReasoning: false,
    loadModels: async () => [],
    personas: PERSONAS,
    prompts: [...BUILT_IN_PROMPTS, SAVED],
    savedPrompts: [SAVED],
    lastUserMessage: "Write test cases for the login page",
    checkDirectory: async () => ({ ok: false, resolved: null, error: "Not a folder" }),
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

const find = (commands: Command[], name: string): Command => {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) throw new Error(`no /${name}`);
  return cmd;
};

const optionsOf = async (cmd: Command) => (cmd.options ? await cmd.options() : []);

describe("parseSlash", () => {
  const commands = buildCommands(context());

  it("leaves ordinary messages alone", () => {
    expect(parseSlash("hello", commands)).toBeNull();
    expect(parseSlash("", commands)).toBeNull();
  });

  it("treats a multi-line draft as prose even when it starts with a slash", () => {
    expect(parseSlash("/model\nsecond line", commands)).toBeNull();
  });

  it("is choosing a command until the first space", () => {
    expect(parseSlash("/", commands)).toEqual({ stage: "command", query: "" });
    expect(parseSlash("/mo", commands)).toEqual({ stage: "command", query: "mo" });
  });

  it("moves to the option stage for a command that has options", () => {
    expect(parseSlash("/model ", commands)).toEqual({ stage: "option", name: "model", query: "" });
    expect(parseSlash("/MODEL son", commands)).toEqual({ stage: "option", name: "model", query: "son" });
    expect(parseSlash("/persona qa", commands)).toEqual({ stage: "option", name: "persona", query: "qa" });
  });

  it("counts a computed list as options, so /save takes a typed name", () => {
    expect(parseSlash("/save my smoke pass", commands)).toEqual({
      stage: "option",
      name: "save",
      query: "my smoke pass",
    });
  });

  it("keeps filtering when the first word runs something or names nothing", () => {
    expect(parseSlash("/new york", commands)).toEqual({ stage: "command", query: "new york" });
    expect(parseSlash("/nope x", commands)).toEqual({ stage: "command", query: "nope x" });
  });

  it("does not open the options of a disabled command", () => {
    const offline = buildCommands(context({ settings: null, personas: null }));
    expect(parseSlash("/persona ", offline)).toEqual({ stage: "command", query: "persona " });
    const nothingSent = buildCommands(context({ lastUserMessage: null }));
    expect(parseSlash("/save name", nothingSent)).toEqual({ stage: "command", query: "save name" });
  });
});

describe("hasOptions", () => {
  it("is true for options, resolve and compute, false for run", () => {
    const commands = buildCommands(context());
    expect(hasOptions(find(commands, "model"))).toBe(true);
    expect(hasOptions(find(commands, "cd"))).toBe(true);
    expect(hasOptions(find(commands, "save"))).toBe(true);
    expect(hasOptions(find(commands, "new"))).toBe(false);
    expect(hasOptions(find(commands, "stop"))).toBe(false);
  });
});

describe("filterByQuery", () => {
  const names = ["common", "model", "remote", "mode"];
  const byName = (q: string) => filterByQuery(names, q, (n) => n);

  it("keeps the original order for an empty query", () => {
    expect(byName("  ")).toEqual(names);
  });

  it("ranks earlier matches higher, so prefixes come first, then keeps list order", () => {
    expect(byName("mo")).toEqual(["model", "mode", "remote", "common"]);
  });

  it("is case-insensitive and drops non-matches", () => {
    expect(byName("MOD")).toEqual(["model", "mode"]);
    expect(byName("zzz")).toEqual([]);
  });
});

describe("buildCommands", () => {
  it("registers the new commands beside the existing ones", () => {
    const names = buildCommands(context()).map((c) => c.name);
    expect(names).toEqual([
      "new",
      "model",
      "effort",
      "persona",
      "resume",
      "cd",
      "thinking",
      "approve",
      "prompt",
      "save",
      "unsave",
      "copy",
      "export",
      "stop",
    ]);
  });

  describe("/persona", () => {
    it("says why it is unavailable", () => {
      expect(find(buildCommands(context({ personas: null })), "persona").disabled).toBe("Still connecting");
      expect(find(buildCommands(context({ settings: null })), "persona").disabled).toBe("Still connecting");
      expect(find(buildCommands(context({ personas: [] })), "persona").disabled).toMatch(/No personas/);
      expect(find(buildCommands(context()), "persona").disabled).toBeNull();
    });

    it("offers None first, then each persona, with the current one checked", async () => {
      const ctx = context({ settings: { ...SETTINGS, persona: "code-reviewer" } });
      const rows = await optionsOf(find(buildCommands(ctx), "persona"));
      expect(rows.map((r) => r.label)).toEqual(["None", "QA Engineer", "Code Reviewer"]);
      expect(rows.map((r) => !!r.checked)).toEqual([false, false, true]);
      expect(rows[1].hint).toBe("Thinks in test cases.");
    });

    it("configures the session with the chosen persona, or null for None", async () => {
      const ctx = context();
      const rows = await optionsOf(find(buildCommands(ctx), "persona"));
      rows[1].run();
      rows[0].run();
      expect(ctx.onConfigure).toHaveBeenNthCalledWith(1, { persona: "qa-engineer" });
      expect(ctx.onConfigure).toHaveBeenNthCalledWith(2, { persona: null });
    });
  });

  describe("/prompt", () => {
    it("lists built-ins and saved prompts as rows that insert their text", async () => {
      const ctx = context();
      const rows = await optionsOf(find(buildCommands(ctx), "prompt"));
      expect(rows).toHaveLength(BUILT_IN_PROMPTS.length + 1);
      expect(rows[0].label).toBe("Test cases from a story");
      expect(rows[0].hint).toBe("Built-in");
      expect(rows[0].insert).toBe(BUILT_IN_PROMPTS[0].text);
      const saved = rows[rows.length - 1];
      expect(saved).toMatchObject({ label: "Smoke pass", hint: "Saved", insert: SAVED.text });
    });

    it("never sends or configures anything when a row is chosen", async () => {
      const ctx = context();
      const rows = await optionsOf(find(buildCommands(ctx), "prompt"));
      rows.forEach((r) => r.run());
      expect(ctx.onConfigure).not.toHaveBeenCalled();
      expect(ctx.onSavePrompt).not.toHaveBeenCalled();
    });
  });

  describe("/save", () => {
    it("is disabled until something has been sent", () => {
      const cmd = find(buildCommands(context({ lastUserMessage: null })), "save");
      expect(cmd.disabled).toMatch(/Nothing to save/);
    });

    it("names the prompt after the message when no name is typed", () => {
      const ctx = context();
      const [row] = find(buildCommands(ctx), "save").compute!("");
      expect(row.label).toBe("Save as “Write test cases for the login page”");
      row.run();
      expect(ctx.onSavePrompt).toHaveBeenCalledWith(
        "Write test cases for the login page",
        "Write test cases for the login page",
      );
    });

    it("uses a typed name and warns when it replaces one", () => {
      const ctx = context();
      const save = find(buildCommands(ctx), "save");
      expect(save.compute!("  Login cases ")[0]).toMatchObject({
        label: "Save as “Login cases”",
        hint: "Reuse it any time from /prompt",
      });
      const [replacing] = save.compute!("smoke PASS");
      expect(replacing.hint).toMatch(/Replaces/);
      replacing.run();
      expect(ctx.onSavePrompt).toHaveBeenCalledWith("smoke PASS", "Write test cases for the login page");
    });
  });

  describe("/unsave", () => {
    it("is disabled with nothing saved", () => {
      expect(find(buildCommands(context({ savedPrompts: [] })), "unsave").disabled).toMatch(/No saved/);
    });

    it("lists only saved prompts and deletes by id", async () => {
      const ctx = context();
      const rows = await optionsOf(find(buildCommands(ctx), "unsave"));
      expect(rows.map((r) => r.label)).toEqual(["Smoke pass"]);
      expect(rows[0].hint).toBe("Run a smoke pass over checkout");
      rows[0].run();
      expect(ctx.onDeletePrompt).toHaveBeenCalledWith("saved:1");
    });
  });
});
