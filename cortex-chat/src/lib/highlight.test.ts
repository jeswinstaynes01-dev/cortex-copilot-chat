import { describe, expect, it } from "vitest";
import type { Token, TokenType } from "./highlight";
import { highlight, languageLabel } from "./highlight";

/** Only the coloured runs, as [type, text] pairs — what a reader would see. */
const marked = (code: string, lang: string) =>
  highlight(code, lang)
    .filter((t) => t.type !== "plain")
    .map((t): [TokenType, string] => [t.type, t.text]);

const joined = (tokens: Token[]) => tokens.map((t) => t.text).join("");

const SAMPLES: Record<string, string> = {
  ts: 'const n: number = 0x1f; // hex\nconst s = `a ${n}\nb`; /* end */',
  tsx: "export function A() { return <div className=\"a\">{1}</div>; }",
  java: 'public class A {\n  /** doc */\n  int n = 42; String s = "x\\"y";\n  String t = """\n  text\n  """;\n}',
  json: '{"a": 1, "b": [true, null], "c": -2.5e3}',
  sql: "SELECT id, 'it''s' FROM users -- note\nWHERE n > 10 /* x */;",
  bash: 'echo "hi $USER" # greet\nn=${#arr[@]}; echo $#',
  powershell: 'if ($a -eq 1) { "C:\\" } # done\n<# block #>\nGet-Item `\n  -Path .',
  python: 'def f(x):\n    """Doc."""\n    return x * 2  # double',
  yaml: "name: cortex # app\nport: 8080\nenabled: true\nurl: http://x/#frag",
  xml: '<a href="x">it\'s</a><!-- c --><br/>',
  css: ".a { color: #e3102f; margin: -1px !important; } /* c */\n@media (max-width: 600px) {}",
  nonsense: "anything <at> all 'here'",
};

describe("highlight", () => {
  it.each(Object.entries(SAMPLES))("gives back exactly the input for %s", (lang, code) => {
    expect(joined(highlight(code, lang))).toBe(code);
  });

  it("returns one plain run for an unknown language, and nothing for no code", () => {
    expect(highlight("x = 1 # y", "cobol")).toEqual([{ type: "plain", text: "x = 1 # y" }]);
    expect(highlight("x = 1", "")).toEqual([{ type: "plain", text: "x = 1" }]);
    expect(highlight("", "ts")).toEqual([]);
  });

  it("merges neighbouring plain text into one run", () => {
    const tokens = highlight("a + b + c", "js");
    expect(tokens).toEqual([{ type: "plain", text: "a + b + c" }]);
  });

  it("colours TypeScript", () => {
    expect(marked("const x = 'a'; // b\nreturn 2;", "ts")).toEqual([
      ["keyword", "const"],
      ["string", "'a'"],
      ["comment", "// b"],
      ["keyword", "return"],
      ["number", "2"],
    ]);
  });

  it("treats tsx and jsx as their base languages", () => {
    expect(marked("import x from 'y'", "tsx")).toEqual(marked("import x from 'y'", "ts"));
    expect(marked("let a = 1", "jsx")).toEqual([
      ["keyword", "let"],
      ["number", "1"],
    ]);
  });

  it("does not colour a member that spells a keyword, or digits inside a name", () => {
    expect(marked("map.delete(key1)", "ts")).toEqual([]);
  });

  it("keeps a template literal open across lines", () => {
    expect(marked("`a\nb` + 1", "ts")).toEqual([
      ["string", "`a\nb`"],
      ["number", "1"],
    ]);
  });

  it("colours Java, including text blocks", () => {
    expect(marked('int n = 42; String t = """\nx\n""";', "java")).toEqual([
      ["keyword", "int"],
      ["number", "42"],
      ["string", '"""\nx\n"""'],
    ]);
  });

  it("colours JSON keys and values as strings, literals as keywords", () => {
    expect(marked('{"a": 1.5, "b": null}', "json")).toEqual([
      ["string", '"a"'],
      ["number", "1.5"],
      ["string", '"b"'],
      ["keyword", "null"],
    ]);
  });

  it("colours SQL whatever the case", () => {
    expect(marked("select * From t where n = 'x' -- c", "sql")).toEqual([
      ["keyword", "select"],
      ["keyword", "From"],
      ["keyword", "where"],
      ["string", "'x'"],
      ["comment", "-- c"],
    ]);
  });

  it("only starts a shell comment at the start of a word", () => {
    expect(marked('echo "$#" a#b # real', "sh")).toEqual([
      ["keyword", "echo"],
      ["string", '"$#"'],
      ["comment", "# real"],
    ]);
  });

  it("knows PowerShell's operators, backtick escape and block comments", () => {
    expect(marked('if ($x -EQ "C:\\") { $true } <# b #>', "ps1")).toEqual([
      ["keyword", "if"],
      ["keyword", "-EQ"],
      ["string", '"C:\\"'],
      ["keyword", "$true"],
      ["comment", "<# b #>"],
    ]);
  });

  it("colours Python, including docstrings", () => {
    expect(marked('def f():\n    """Doc."""\n    return None  # x', "py")).toEqual([
      ["keyword", "def"],
      ["string", '"""Doc."""'],
      ["keyword", "return"],
      ["keyword", "None"],
      ["comment", "# x"],
    ]);
  });

  it("colours YAML keys and leaves a # inside a value alone", () => {
    expect(marked("on-call: true\nurl: http://x/#y # note", "yml")).toEqual([
      ["keyword", "on-call"],
      ["keyword", "true"],
      ["keyword", "url"],
      ["comment", "# note"],
    ]);
  });

  it("colours markup tags and attribute values, not apostrophes in text", () => {
    expect(marked("<p class='x'>don't</p><!-- c -->", "html")).toEqual([
      ["keyword", "p"],
      ["string", "'x'"],
      ["keyword", "p"],
      ["comment", "<!-- c -->"],
    ]);
  });

  it("colours CSS colours, units, at-rules and !important", () => {
    expect(marked("@media x { a { color: #fff; margin: -1px !important } }", "css")).toEqual([
      ["keyword", "@media"],
      ["number", "#fff"],
      ["number", "1px"],
      ["keyword", "!important"],
    ]);
  });

  it("does not run away on unterminated input", () => {
    expect(marked("echo don't\nls", "bash")).toEqual([
      ["keyword", "echo"],
      ["string", "'t"],
    ]);
    expect(marked("a /* never closed\nb", "ts")).toEqual([["comment", "/* never closed\nb"]]);
    expect(marked('<a href="x', "xml")).toEqual([
      ["keyword", "a"],
      ["string", '"x'],
    ]);
  });
});

describe("languageLabel", () => {
  it("names common fence spellings", () => {
    expect(languageLabel("ts")).toBe("TypeScript");
    expect(languageLabel("JavaScript")).toBe("JavaScript");
    expect(languageLabel("tsx")).toBe("TSX");
    expect(languageLabel("yml")).toBe("YAML");
    expect(languageLabel("pwsh")).toBe("PowerShell");
    expect(languageLabel("xml")).toBe("XML");
    expect(languageLabel("html")).toBe("HTML");
  });

  it("falls back to the fence text, or Code when there is none", () => {
    expect(languageLabel("cobol")).toBe("cobol");
    expect(languageLabel("  ")).toBe("Code");
  });
});
