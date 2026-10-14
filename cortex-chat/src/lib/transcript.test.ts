import { describe, expect, it } from "vitest";
import { copyText, slug, toMarkdown } from "./transcript";
import type { Conversation, Message } from "./types";

const message = (over: Partial<Message>): Message => ({
  id: Math.random().toString(36),
  role: "user",
  text: "",
  reasoning: "",
  tools: [],
  permissions: [],
  streaming: false,
  createdAt: 0,
  ...over,
});

const conversation = (messages: Message[]): Conversation => ({
  id: "c1",
  title: "Login tests",
  messages,
  updatedAt: Date.UTC(2025, 9, 14, 9, 5),
});

describe("toMarkdown", () => {
  it("writes a title, an export stamp and one section per message", () => {
    const md = toMarkdown(
      conversation([
        message({ role: "user", text: "  Write test cases  " }),
        message({ role: "assistant", text: "Here they are.", reasoning: "private thoughts" }),
      ]),
    );
    expect(md).toBe(
      "# Login tests\n\n_Exported from Cortex · 2025-10-14 09:05_\n\n" +
        "### You\n\nWrite test cases\n\n---\n\n### Cortex\n\nHere they are.\n",
    );
    expect(md).not.toContain("private thoughts");
  });

  it("lists tool calls with their outcome before the reply", () => {
    const md = toMarkdown(
      conversation([
        message({
          role: "assistant",
          text: "Done.",
          tools: [
            { id: "1", name: "view", title: "Read pom.xml", status: "done", detail: "120 lines" },
            { id: "2", name: "powershell", status: "failed" },
            { id: "3", name: "grep", status: "running" },
          ],
        }),
      ]),
    );
    expect(md).toContain(
      "### Cortex\n\n- ✓ `Read pom.xml` — 120 lines\n- ✗ `powershell`\n- … `grep`\n\nDone.",
    );
  });

  it("keeps a notice as a quote and omits an empty reply body", () => {
    const md = toMarkdown(conversation([message({ role: "assistant", text: "  ", notice: "Stopped by you" })]));
    expect(md).toContain("### Cortex\n\n> Stopped by you\n");
    expect(md).not.toContain("### Cortex\n\n\n");
  });

  it("passes a fenced code block through untouched", () => {
    const code = "```ts\nconst a = 1;\n```";
    const md = toMarkdown(conversation([message({ role: "assistant", text: `See:\n\n${code}` })]));
    expect(md).toContain(`See:\n\n${code}\n`);
  });
});

describe("slug", () => {
  it("makes a filesystem-safe lowercase name", () => {
    expect(slug("  Login: edge cases (v2)! ")).toBe("login-edge-cases-v2");
  });

  it("caps the length and never returns nothing", () => {
    expect(slug("a".repeat(80))).toHaveLength(48);
    expect(slug("!!!")).toBe("cortex-chat");
  });
});

describe("copyText", () => {
  it("reports failure instead of throwing when there is no clipboard", async () => {
    await expect(copyText("x")).resolves.toBe(false);
  });
});
