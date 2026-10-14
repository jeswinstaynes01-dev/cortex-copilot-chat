import { useEffect, useMemo, useRef, useState } from "react";
import { highlight, languageLabel } from "../lib/highlight";
import { copyText } from "../lib/transcript";
import { Icon } from "./Icons";

interface Props {
  code: string;
  /** The fence's info string, e.g. "ts". Empty when the model gave none. */
  lang: string;
  /** The fence has not closed and the reply is still arriving. */
  open?: boolean;
}

/* A fenced block from a reply. The tokenizer hands back typed runs and each
   one becomes a <span>, so whatever the model wrote is shown as text and can
   never become markup. Copy takes the original string, not the DOM, so it
   gets exactly the code — no header, no line breaks invented by layout. */
export function CodeBlock({ code, lang, open = false }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  /* Streaming re-renders the whole reply on every token. Only the block that
     is actually growing re-tokenizes; finished blocks above it keep theirs. */
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async () => {
    if (!(await copyText(code))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  /* Half a function copied mid-stream is a trap, so Copy waits for the
     closing fence. A reply that ends without one is still copyable — `open`
     is only set while the message is streaming. */
  const label = open ? "Code still being written" : copied ? "Copied" : "Copy code";

  return (
    <div className="codeblock" data-open={open || undefined}>
      <div className="codeblock__head">
        <span className="codeblock__lang">{languageLabel(lang)}</span>
        <button
          type="button"
          className="codeblock__copy"
          aria-label={label}
          disabled={open}
          onClick={onCopy}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
          <span aria-hidden="true">{open ? "Writing…" : copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {/* Focusable so a keyboard user can scroll a long line sideways. */}
      <pre className="codeblock__pre" tabIndex={0}>
        <code>
          {tokens.map((t, i) =>
            t.type === "plain" ? (
              t.text
            ) : (
              <span key={i} className={`tok tok--${t.type}`}>
                {t.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
