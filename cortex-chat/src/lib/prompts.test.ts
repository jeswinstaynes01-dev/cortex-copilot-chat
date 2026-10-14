import { describe, expect, it } from "vitest";
import type { PromptStore } from "./prompts";
import {
  BUILT_IN_PROMPTS,
  PROMPTS_KEY,
  defaultPromptName,
  deletePrompt,
  findSavedPrompt,
  loadSavedPrompts,
  savePrompt,
} from "./prompts";

/** An in-memory stand-in for localStorage, with the raw map exposed. */
function memory(initial?: unknown) {
  const map = new Map<string, string>();
  if (initial !== undefined) {
    map.set(PROMPTS_KEY, typeof initial === "string" ? initial : JSON.stringify(initial));
  }
  const store: PromptStore = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  return { store, map };
}

describe("built-in prompts", () => {
  it("ships the six QA templates in order", () => {
    expect(BUILT_IN_PROMPTS.map((p) => p.name)).toEqual([
      "Test cases from a story",
      "Regression scope",
      "Bug report from notes",
      "Boundary values",
      "API test checklist",
      "Review my test cases",
    ]);
  });

  it("marks them built-in with unique ids", () => {
    const ids = BUILT_IN_PROMPTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BUILT_IN_PROMPTS) {
      expect(p.builtIn).toBe(true);
      expect(p.id.startsWith("builtin:")).toBe(true);
    }
  });

  it("ends every template on a label line to paste under", () => {
    for (const p of BUILT_IN_PROMPTS) expect(p.text).toMatch(/\n\n[A-Z][\w ]*:\n$/);
    expect(BUILT_IN_PROMPTS[0].text.endsWith("Story:\n")).toBe(true);
  });

  it("asks for the formats the task needs", () => {
    const [cases, regression, bug, boundary, api, review] = BUILT_IN_PROMPTS.map((p) => p.text);
    expect(cases).toContain("ID | Scenario | Preconditions | Steps | Expected result | Priority");
    expect(cases).toMatch(/mandatory and optional/);
    expect(regression).toMatch(/ranked by risk/);
    expect(regression).toMatch(/safe to skip/);
    for (const section of [
      "Title",
      "Environment",
      "Preconditions",
      "Steps to reproduce",
      "Expected",
      "Actual",
      "Severity",
      "Priority",
      "Evidence",
    ]) {
      expect(bug).toContain(section);
    }
    expect(boundary).toMatch(/equivalence partition/);
    for (const topic of ["status codes", "schema", "auth", "negative inputs", "idempotency", "pagination", "performance"]) {
      expect(api.toLowerCase()).toContain(topic);
    }
    expect(review).toMatch(/duplicates/);
  });
});

describe("saved prompts", () => {
  it("starts empty", () => {
    expect(loadSavedPrompts(memory().store)).toEqual([]);
  });

  it("saves, reloads and keeps the newest first", () => {
    const { store } = memory();
    savePrompt("First", "one", store);
    const list = savePrompt("Second", "two", store);
    expect(list.map((p) => p.name)).toEqual(["Second", "First"]);
    expect(loadSavedPrompts(store)).toEqual(list);
    expect(list.every((p) => !p.builtIn && p.id.startsWith("saved:"))).toBe(true);
  });

  it("stores only id, name and text under the versioned key", () => {
    const { store, map } = memory();
    savePrompt("Name", "body", store);
    const raw = JSON.parse(map.get(PROMPTS_KEY) ?? "null");
    expect(raw).toHaveLength(1);
    expect(Object.keys(raw[0]).sort()).toEqual(["id", "name", "text"]);
  });

  it("replaces a prompt saved under the same name, ignoring case", () => {
    const { store } = memory();
    savePrompt("Smoke", "old", store);
    savePrompt("Other", "keep", store);
    const list = savePrompt("  SMOKE ", "new", store);
    expect(list.map((p) => [p.name, p.text])).toEqual([
      ["SMOKE", "new"],
      ["Other", "keep"],
    ]);
  });

  it("names an unnamed prompt after its opening words", () => {
    const { store } = memory();
    const [p] = savePrompt("", "Check the   checkout\nflow", store);
    expect(p.name).toBe("Check the checkout flow");
  });

  it("refuses to save blank text", () => {
    const { store, map } = memory();
    expect(savePrompt("Empty", "   \n", store)).toEqual([]);
    expect(map.has(PROMPTS_KEY)).toBe(false);
  });

  it("deletes by id and leaves built-ins alone", () => {
    const { store } = memory();
    savePrompt("A", "a", store);
    const [b] = savePrompt("B", "b", store);
    expect(deletePrompt(BUILT_IN_PROMPTS[0].id, store)).toHaveLength(2);
    expect(deletePrompt(b.id, store).map((p) => p.name)).toEqual(["A"]);
    expect(loadSavedPrompts(store).map((p) => p.name)).toEqual(["A"]);
  });

  it("finds a saved prompt by name, trimmed and case-insensitive", () => {
    const { store } = memory();
    const saved = savePrompt("Login cases", "x", store);
    expect(findSavedPrompt(saved, "  LOGIN cases ")?.name).toBe("Login cases");
    expect(findSavedPrompt(saved, "logout")).toBeUndefined();
    expect(findSavedPrompt(saved, "  ")).toBeUndefined();
  });
});

describe("corrupt storage", () => {
  it.each([
    ["not JSON", "{oops"],
    ["an object", { name: "x", text: "y" }],
    ["a string", "\"just text\""],
    ["null", "null"],
  ])("reads %s as no prompts", (_, raw) => {
    expect(loadSavedPrompts(memory(raw).store)).toEqual([]);
  });

  it("skips unusable entries and keeps the good ones", () => {
    const { store } = memory([
      null,
      42,
      "text",
      { name: "No text" },
      { name: 7, text: "wrong type" },
      { name: "  ", text: "blank name" },
      { name: "Blank text", text: "  " },
      { id: "saved:ok", name: " Good ", text: "keep me" },
      { id: "saved:dup", name: "good", text: "duplicate name" },
    ]);
    expect(loadSavedPrompts(store)).toEqual([{ id: "saved:ok", name: "Good", text: "keep me", builtIn: false }]);
  });

  it("gives an entry without a usable id one that survives a reload, so it can be deleted", () => {
    const { store } = memory([
      { name: "No id", text: "a" },
      { id: "same", name: "First", text: "b" },
      { id: "same", name: "Second", text: "c" },
    ]);
    const first = loadSavedPrompts(store);
    expect(loadSavedPrompts(store)).toEqual(first);
    expect(new Set(first.map((p) => p.id)).size).toBe(3);
    const noId = first.find((p) => p.name === "No id")!;
    expect(deletePrompt(noId.id, store).map((p) => p.name)).toEqual(["First", "Second"]);
  });

  it("survives storage that throws, or no storage at all", () => {
    const broken: PromptStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadSavedPrompts(broken)).toEqual([]);
    expect(savePrompt("Still works", "for this visit", broken).map((p) => p.name)).toEqual(["Still works"]);
    expect(loadSavedPrompts(null)).toEqual([]);
    expect(savePrompt("x", "y", null)).toHaveLength(1);
  });
});

describe("defaultPromptName", () => {
  it("flattens whitespace and keeps short text whole", () => {
    expect(defaultPromptName("  Review\n\tthese  cases ")).toBe("Review these cases");
  });

  it("cuts long text at a word boundary near 40 characters", () => {
    const name = defaultPromptName("Write negative test cases for the password reset flow on mobile");
    expect(name).toBe("Write negative test cases for the…");
    expect(name.length).toBeLessThanOrEqual(41);
  });

  it("cuts mid-word only when one word fills the budget", () => {
    expect(defaultPromptName("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
  });

  it("falls back for empty text", () => {
    expect(defaultPromptName(" \n ")).toBe("Untitled prompt");
  });
});
