import type { ReactNode } from "react";
import { CodeBlock } from "../components/CodeBlock";

/* ==========================================================================
   A deliberately small Markdown renderer.

   It returns React elements rather than an HTML string, so there is no
   `dangerouslySetInnerHTML` anywhere and model output can never inject
   markup. It covers what a chat reply actually uses — bold, italic, inline
   code, headings, bullet and numbered lists, fenced code blocks — and leaves
   everything else as plain text.
   ========================================================================== */

/* The capture group matters: `String.split` with a capturing regex keeps the
   matched separators in the output array, so the formatted runs survive. */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;

function inline(text: string, key: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, i) => {
      const k = `${key}-${i}`;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return <strong key={k}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return <code key={k}>{part.slice(1, -1)}</code>;
      }
      if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
        return <em key={k}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
}

/* A fence is three or more backticks or tildes. Models indent them inside
   list items, so leading spaces are allowed, and that indent is taken back
   off the code lines. The closing fence must use the same character and be
   at least as long, which is what lets a ```` block show a ``` example. */
const FENCE = /^( *)(`{3,}|~{3,})(.*)$/;

interface Fence {
  indent: number;
  marks: string;
  lang: string;
}

function openFence(line: string): Fence | null {
  /* trimEnd, because `.` stops at a carriage return: without it a CRLF reply
     would never open a block at all. */
  const m = FENCE.exec(line.trimEnd());
  if (!m) return null;
  const [, indent, marks, info] = m;
  /* "```x```" on one line is inline code that happens to use three
     backticks, not a block — a backtick fence's info string cannot contain
     one, so it can never be mistaken for a language. */
  if (marks[0] === "`" && info.includes("`")) return null;
  const lang = /^[\w+#.-]*/.exec(info.trim())?.[0] ?? "";
  return { indent: indent.length, marks, lang };
}

const closesFence = (line: string, f: Fence) => {
  const t = line.trim();
  return t.length >= f.marks.length && [...t].every((c) => c === f.marks[0]);
};

/* A short run of the fence character: the closing fence, half-streamed. */
const partialClose = (line: string, f: Fence) => {
  const t = line.trim();
  return t.length > 0 && t.length < f.marks.length && [...t].every((c) => c === f.marks[0]);
};

function dedent(line: string, n: number): string {
  let k = 0;
  while (k < n && line[k] === " ") k++;
  return line.slice(k).replace(/\r$/, "");
}

/**
 * @param streaming the reply is still arriving. An unclosed fence then means
 *   "more code is coming" and renders as an in-progress block; once the reply
 *   is complete the same fence simply runs to the end, as CommonMark has it.
 */
export function renderMarkdown(src: string, streaming = false): ReactNode[] {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let items: string[] = [];
  let ordered = false;
  let start = 1;
  let n = 0;

  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={`p${n++}`}>{inline(para.join(" "), `p${n}`)}</p>);
    para = [];
  };

  /* `start` keeps the count going when a list resumes after a code block —
     "1. Install", a fence, "2. Run" — instead of numbering from one again. */
  const flushList = () => {
    if (!items.length) return;
    const li = items.map((t, i) => <li key={i}>{inline(t, `li${n}-${i}`)}</li>);
    out.push(
      ordered ? (
        <ol key={`l${n++}`} start={start === 1 ? undefined : start}>
          {li}
        </ol>
      ) : (
        <ul key={`l${n++}`}>{li}</ul>
      ),
    );
    items = [];
  };

  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const fence = openFence(lines[i]);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      let closed = false;
      while (++i < lines.length) {
        if (closesFence(lines[i], fence)) {
          closed = true;
          break;
        }
        body.push(dedent(lines[i], fence.indent));
      }
      const open = !closed && streaming;
      /* Mid-stream the last line is often the closing fence arriving one
         character at a time, or the empty line before it. Neither is code,
         and showing them makes the block jump when the fence lands. */
      const last = body[body.length - 1];
      if (open && last !== undefined && (!last.trim() || partialClose(last, fence))) body.pop();
      out.push(<CodeBlock key={`c${n++}`} code={body.join("\n")} lang={fence.lang} open={open} />);
      continue;
    }

    const line = lines[i].trimEnd();

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
      out.push(<Tag key={`h${n++}`}>{inline(heading[2], `h${n}`)}</Tag>);
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);

    if (bullet || numbered) {
      flushPara();
      const wantOrdered = Boolean(numbered);
      /* A change of list type has to close the previous list, or bullets and
         numbers end up sharing one element. */
      if (items.length && wantOrdered !== ordered) flushList();
      ordered = wantOrdered;
      if (!items.length) start = numbered ? Number(numbered[1]) || 1 : 1;
      items.push(numbered ? numbered[2] : (bullet?.[1] ?? ""));
      continue;
    }

    flushList();
    para.push(line);
  }

  flushPara();
  flushList();
  return out;
}
