import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

const html = (src: string, streaming = false) => renderToStaticMarkup(<>{renderMarkdown(src, streaming)}</>);

/** The text inside each code block's <code>, with the token spans removed. */
const codeOf = (markup: string) =>
  [...markup.matchAll(/<code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("renderMarkdown: fenced code", () => {
  it("renders a block with a language header, a Copy button and coloured tokens", () => {
    const out = html("Here:\n\n```ts\nconst n = 1; // one\n```\n\nDone.");
    expect(out).toContain('class="codeblock"');
    expect(out).toContain('<span class="codeblock__lang">TypeScript</span>');
    expect(out).toContain('aria-label="Copy code"');
    expect(out).toContain('<span class="tok tok--keyword">const</span>');
    expect(out).toContain('<span class="tok tok--number">1</span>');
    expect(out).toContain('<span class="tok tok--comment">// one</span>');
    expect(out).toMatch(/^<p>Here:<\/p><div class="codeblock">[\s\S]*<\/div><p>Done\.<\/p>$/);
    expect(codeOf(out)).toEqual(["const n = 1; // one"]);
  });

  it("shows code as text, never as markup", () => {
    const out = html('```html\n<script>alert("x")</script>\n```');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;");
    expect(codeOf(out)[0]).toContain("&lt;/");
  });

  it("labels a fence with no language as Code and leaves it uncoloured", () => {
    const out = html("```\nplain words 42\n```");
    expect(out).toContain('<span class="codeblock__lang">Code</span>');
    expect(out).not.toContain("tok--");
    expect(codeOf(out)).toEqual(["plain words 42"]);
  });

  it("keeps blank lines and indentation inside a block", () => {
    const out = html("```py\ndef f():\n\n    return 1\n```");
    expect(codeOf(out)[0]).toBe("def f():\n\n    return 1");
  });

  it("takes a list item's indent back off an indented fence", () => {
    const out = html("1. Install:\n   ```bash\n   npm ci\n     nested\n   ```\n2. Run it");
    expect(codeOf(out)).toEqual(["npm ci\n  nested"]);
    expect(out).toContain('<ol start="2">');
  });

  it("lets a longer fence show a shorter one, and tildes work too", () => {
    expect(codeOf(html("````md\n```js\nx\n```\n````"))).toEqual(["```js\nx\n```"]);
    expect(codeOf(html("~~~\nkeep ``` here\n~~~"))).toEqual(["keep ``` here"]);
  });

  it("treats triple backticks on one line as inline code, not a block", () => {
    const out = html("Use ```npm test``` to run.");
    expect(out).not.toContain("codeblock");
  });

  it("renders a half-streamed block as one still being written", () => {
    const out = html("Sure:\n\n```java\npublic class A {\n``", true);
    expect(out).toContain('data-open="true"');
    expect(out).toContain('aria-label="Code still being written"');
    expect(out).toMatch(/<button[^>]*disabled=""/);
    expect(codeOf(out)).toEqual(["public class A {"]);
  });

  it("copes with a fence that has only just opened", () => {
    expect(() => html("```", true)).not.toThrow();
    expect(() => html("```ts", true)).not.toThrow();
    expect(codeOf(html("```ts\n", true))).toEqual([""]);
  });

  it("runs an unclosed fence to the end once the reply is complete", () => {
    const out = html("```sql\nselect 1\n", false);
    expect(out).not.toContain("data-open");
    expect(out).toContain('aria-label="Copy code"');
    expect(codeOf(out)).toEqual(["select 1\n"]);
  });

  it("drops the carriage return from CRLF code lines", () => {
    expect(codeOf(html("```\r\na\r\nb\r\n```\r\n"))).toEqual(["a\nb"]);
  });
});

describe("renderMarkdown: prose", () => {
  it("still renders headings, lists and inline formatting", () => {
    const out = html("# Title\n\n- **bold** and *it* with `code`\n- two\n\n3. three");
    expect(out).toContain("<h3>Title</h3>");
    expect(out).toContain("<li><strong>bold</strong> and <em>it</em> with <code>code</code></li>");
    expect(out).toContain('<ol start="3"><li>three</li></ol>');
  });
});
