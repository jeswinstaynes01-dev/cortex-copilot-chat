/**
 * highlight.ts — a deliberately small syntax highlighter for code blocks.
 *
 * It returns a flat list of typed runs instead of HTML, so the renderer turns
 * each run into a React element and model output can never inject markup.
 * Concatenating the runs always gives back the input exactly — nothing is
 * dropped or re-spaced — which is what lets Copy hand over the original text.
 *
 * Four kinds of run are worth colouring in a chat reply: comments, strings,
 * numbers and keywords. Real grammars are out of scope; this is a single pass
 * with a little per-language knowledge, and when it is wrong it is wrong in
 * colour only. An unknown language comes back as one plain run.
 */

export type TokenType = "comment" | "string" | "number" | "keyword" | "plain";

export interface Token {
  type: TokenType;
  text: string;
}

interface Lang {
  /** Display name for the code-block header. */
  label: string;
  line?: string[];
  block?: Array<[string, string]>;
  /** Quote characters that open a string. */
  quotes?: string[];
  /** Quotes whose strings may run across lines: template literals. */
  multiline?: string[];
  /** Python's and Java's """ blocks. */
  triple?: boolean;
  /** Escape character inside strings. PowerShell uses a backtick, and a
      backslash there is a path separator — `"C:\"` must still close. */
  escape?: string | null;
  keywords?: Set<string>;
  /** SQL and PowerShell do not care about case. */
  caseless?: boolean;
  /** Characters allowed after the first one in a word. */
  word?: RegExp;
  /** `#` only starts a comment at the start of a word in shells and YAML,
      so `$#`, `${#arr[@]}` and `a#b` stay what they are. */
  hashNeedsGap?: boolean;
  /** PowerShell's `-eq`, `-and`… are words that start with a dash. */
  dashWords?: boolean;
  /** YAML keys (`name:`) are the structure worth seeing, so they count. */
  keysBeforeColon?: boolean;
  /** CSS colours such as `#e3102f` read as values, not selectors. */
  hexColors?: boolean;
  /** Characters that may open a word: CSS's `@media` and `!important`. */
  sigils?: string;
  /** XML and HTML get their own small scanner — see `markup()`. */
  markup?: boolean;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

const JS_KEYWORDS = words(`
  abstract as async await break case catch class const continue debugger declare default
  delete do else enum export extends false finally for from function if implements import
  in infer instanceof interface is keyof let namespace new null of private protected public
  readonly return satisfies static super switch this throw true try type typeof undefined
  var void while with yield`);

const JAVA_KEYWORDS = words(`
  abstract assert boolean break byte case catch char class const continue default do double
  else enum extends false final finally float for goto if implements import instanceof int
  interface long native new non-sealed null package permits private protected public record
  return sealed short static strictfp super switch synchronized this throw throws transient
  true try var void volatile while yield`);

const PYTHON_KEYWORDS = words(`
  False None True and as assert async await break case class continue def del elif else
  except finally for from global if import in is lambda match nonlocal not or pass raise
  return try while with yield`);

const SQL_KEYWORDS = words(`
  add all alter and any as asc begin between by case cast check column commit constraint
  count create cross default delete desc distinct drop else end exists false fetch first
  foreign from full grant group having if in index inner insert intersect into is join key
  left like limit merge next not null offset on only or order outer over partition primary
  references returning revoke right rollback rows select set table then top true truncate
  union unique update using values view when where with`);

const BASH_KEYWORDS = words(`
  alias break case cd continue declare do done echo elif else esac eval exec exit export
  false fi for function if in local readonly return set shift source then trap true unset
  until while`);

const PS_KEYWORDS = words(`
  begin break catch class continue do dynamicparam else elseif end enum exit filter finally
  for foreach function if in param process return switch throw trap try until using while
  $true $false $null -and -or -not -xor -eq -ne -gt -ge -lt -le -like -notlike -match
  -notmatch -contains -notcontains -in -notin -is -isnot -replace -split -join`);

const YAML_KEYWORDS = words("true false null yes no on off");

const CSS_KEYWORDS = words(`
  @media @import @supports @keyframes @font-face @layer @container @property @page @charset
  !important auto none inherit initial unset revert transparent currentcolor`);

const JSON_KEYWORDS = words("true false null");

const JS: Lang = {
  label: "TypeScript",
  line: ["//"],
  block: [["/*", "*/"]],
  quotes: ['"', "'", "`"],
  multiline: ["`"],
  keywords: JS_KEYWORDS,
};

const LANGS: Record<string, Lang> = {
  js: { ...JS, label: "JavaScript" },
  ts: JS,
  java: {
    label: "Java",
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: ['"', "'"],
    triple: true,
    keywords: JAVA_KEYWORDS,
  },
  json: { label: "JSON", quotes: ['"'], keywords: JSON_KEYWORDS },
  sql: {
    label: "SQL",
    line: ["--"],
    block: [["/*", "*/"]],
    quotes: ["'", '"'],
    escape: null,
    keywords: SQL_KEYWORDS,
    caseless: true,
  },
  bash: {
    label: "Bash",
    line: ["#"],
    quotes: ['"', "'"],
    keywords: BASH_KEYWORDS,
    word: /[\w-]/,
    hashNeedsGap: true,
  },
  powershell: {
    label: "PowerShell",
    line: ["#"],
    block: [["<#", "#>"]],
    quotes: ['"', "'"],
    escape: "`",
    keywords: PS_KEYWORDS,
    caseless: true,
    word: /[\w-]/,
    hashNeedsGap: true,
    dashWords: true,
  },
  python: {
    label: "Python",
    line: ["#"],
    quotes: ['"', "'"],
    triple: true,
    keywords: PYTHON_KEYWORDS,
  },
  yaml: {
    label: "YAML",
    line: ["#"],
    quotes: ['"', "'"],
    keywords: YAML_KEYWORDS,
    word: /[\w.-]/,
    hashNeedsGap: true,
    keysBeforeColon: true,
  },
  css: {
    label: "CSS",
    block: [["/*", "*/"]],
    quotes: ['"', "'"],
    keywords: CSS_KEYWORDS,
    caseless: true,
    word: /[\w-]/,
    hexColors: true,
    sigils: "@!",
  },
  markup: { label: "HTML", markup: true },
};

/* Fence info strings are whatever the model felt like writing, so every common
   spelling of a language lands on the same rules. */
const ALIASES: Record<string, string> = {
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  typescript: "ts",
  tsx: "ts",
  mts: "ts",
  jsonc: "json",
  mysql: "sql",
  postgres: "sql",
  postgresql: "sql",
  plsql: "sql",
  tsql: "sql",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ps: "powershell",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  yml: "yaml",
  xml: "markup",
  html: "markup",
  htm: "markup",
  xhtml: "markup",
  svg: "markup",
  scss: "css",
  less: "css",
};

const LABELS: Record<string, string> = {
  xml: "XML",
  svg: "SVG",
  tsx: "TSX",
  jsx: "JSX",
  scss: "SCSS",
  less: "Less",
};

function langFor(name: string): Lang | null {
  const key = name.trim().toLowerCase();
  return LANGS[ALIASES[key] ?? key] ?? null;
}

/** The name shown in a code block's header, e.g. "ts" → "TypeScript". */
export function languageLabel(name: string): string {
  const key = name.trim().toLowerCase();
  if (!key) return "Code";
  return LABELS[key] ?? langFor(key)?.label ?? key;
}

/**
 * Splits `code` into typed runs. Adjacent plain characters are merged, so a
 * block of prose-like code costs a handful of elements rather than one per
 * character — this runs again on every streamed token.
 */
export function highlight(code: string, lang: string): Token[] {
  const spec = langFor(lang);
  if (!spec || !code) return code ? [{ type: "plain", text: code }] : [];
  return spec.markup ? markup(code) : scan(code, spec);
}

/** Collects runs, merging consecutive plain ones. */
function sink() {
  const out: Token[] = [];
  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (type === "plain" && last?.type === "plain") last.text += text;
    else out.push({ type, text });
  };
  return { out, push };
}

const DIGIT = /[0-9]/;
const WORD_START = /[A-Za-z_$]/;
/* Fixed rather than per-language: in CSS a dash is part of a word, but the
   `1` in `-1px` is still a number. */
const IDENT = /[\w$]/;
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)[A-Za-z%]*/;

function scan(code: string, spec: Lang): Token[] {
  const { out, push } = sink();
  const word = spec.word ?? /[\w$]/;
  const escape = spec.escape === undefined ? "\\" : spec.escape;
  let plain = "";
  let i = 0;

  const flush = () => {
    push("plain", plain);
    plain = "";
  };
  const emit = (type: TokenType, text: string) => {
    flush();
    push(type, text);
  };
  const at = (s: string) => code.startsWith(s, i);
  /* The last character already consumed, whatever run it ended up in. */
  const prev = () => (i > 0 ? code[i - 1] : "");

  while (i < code.length) {
    const ch = code[i];

    const block = spec.block?.find(([open]) => at(open));
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length);
      const stop = end === -1 ? code.length : end + block[1].length;
      emit("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    const line = spec.line?.find((open) => at(open));
    if (line && !(line === "#" && spec.hashNeedsGap && prev() && !/[\s;(]/.test(prev()))) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      emit("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (spec.triple && (at('"""') || at("'''"))) {
      const fence = code.slice(i, i + 3);
      const end = code.indexOf(fence, i + 3);
      const stop = end === -1 ? code.length : end + 3;
      emit("string", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (spec.quotes?.includes(ch)) {
      const multi = spec.multiline?.includes(ch) ?? false;
      let j = i + 1;
      while (j < code.length) {
        const c = code[j];
        if (escape && c === escape) {
          j += 2;
          continue;
        }
        if (c === ch) {
          j++;
          break;
        }
        /* An unclosed quote stops at the end of its line. Otherwise a stray
           apostrophe — "don't" in a shell echo — would paint the rest of the
           block as one string. */
        if (c === "\n" && !multi) break;
        j++;
      }
      const stop = Math.min(j, code.length);
      emit("string", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (spec.hexColors && ch === "#") {
      const hex = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i, i + 10));
      if (hex) {
        emit("number", hex[0]);
        i += hex[0].length;
        continue;
      }
    }

    const startsNumber = DIGIT.test(ch) || (ch === "." && DIGIT.test(code[i + 1] ?? ""));
    if (startsNumber && !IDENT.test(prev())) {
      const m = NUMBER.exec(code.slice(i, i + 64));
      if (m && m[0]) {
        emit("number", m[0]);
        i += m[0].length;
        continue;
      }
    }

    const letterNext = /[A-Za-z]/.test(code[i + 1] ?? "");
    const dashWord = spec.dashWords && ch === "-" && letterNext && !word.test(prev());
    const sigilWord = !!spec.sigils?.includes(ch) && letterNext;
    if (WORD_START.test(ch) || dashWord || sigilWord) {
      let j = i + 1;
      while (j < code.length && word.test(code[j])) j++;
      const text = code.slice(i, j);
      const key = spec.caseless ? text.toLowerCase() : text;
      /* `map.get(...)` is a method, not the `get` keyword — anything reached
         through a dot is a member name, whatever it happens to spell. */
      const member = prev() === ".";
      let type: TokenType = !member && spec.keywords?.has(key) ? "keyword" : "plain";
      if (spec.keysBeforeColon && /^[ \t]*:(?:\s|$)/.test(code.slice(j, j + 40))) {
        type = "keyword";
      }
      emit(type, text);
      i = j;
      continue;
    }

    plain += ch;
    i++;
  }

  flush();
  return out;
}

/* Markup is scanned differently from everything else: text between tags is
   prose, where an apostrophe is just an apostrophe, so quotes only count
   inside a tag. Tag names are the "keywords"; attribute values the strings. */
function markup(code: string): Token[] {
  const { out, push } = sink();
  let i = 0;

  while (i < code.length) {
    if (code.startsWith("<!--", i)) {
      const end = code.indexOf("-->", i + 4);
      const stop = end === -1 ? code.length : end + 3;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    const open = /^<[/?!]?([A-Za-z][\w:.-]*)/.exec(code.slice(i, i + 80));
    if (open) {
      push("plain", open[0].slice(0, open[0].length - open[1].length));
      push("keyword", open[1]);
      i += open[0].length;
      /* Inside the tag: attribute values are strings until the closing `>`. */
      while (i < code.length && code[i] !== ">") {
        const q = code[i];
        if (q === '"' || q === "'") {
          const end = code.indexOf(q, i + 1);
          const stop = end === -1 ? code.length : end + 1;
          push("string", code.slice(i, stop));
          i = stop;
          continue;
        }
        push("plain", code[i]);
        i++;
      }
      continue;
    }

    push("plain", code[i]);
    i++;
  }

  return out;
}
