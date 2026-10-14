import type { CSSProperties } from "react";
import { Icon } from "./Icons";
import type { IconName } from "./Icons";
import { ripple } from "../lib/ripple";

/* Rewritten for what is actually on the other end of the wire. This is a
   coding agent with read and write access to a real working directory, not a
   general-purpose writing assistant, so prompts about meeting notes and
   fashion taglines were advertising the wrong product. */
const CARDS: Array<{ icon: IconName; title: string; body: string; prompt: string }> = [
  {
    icon: "folder",
    title: "Explore the code",
    body: "Summarise the structure of this project and what each module does.",
    prompt:
      "Explore the current working directory and summarise the project structure and what each module is responsible for.",
  },
  {
    icon: "alert",
    title: "Find a bug",
    body: "Review recent changes for logic errors and risky edge cases.",
    prompt:
      "Review the most recent changes in this repository for logic errors, unhandled edge cases and anything that looks risky.",
  },
  {
    icon: "pen",
    title: "Write a test",
    body: "Add coverage for the code path I describe.",
    prompt: "Find the least-tested part of this project and write tests for it.",
  },
];

interface Props {
  onPick: (prompt: string) => void;
}

export function Suggestions({ onPick }: Props) {
  return (
    <div className="suggest-wrap">
      <div className="suggestions">
        {CARDS.map((c, i) => (
          <button
            key={c.title}
            className="card ripple-host"
            style={{ "--i": i } as CSSProperties}
            onPointerDown={ripple}
            onClick={() => onPick(c.prompt)}
          >
            <span className="card__icon">
              <Icon name={c.icon} size={17} />
            </span>
            <span className="card__title">{c.title}</span>
            <span className="card__body">{c.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
