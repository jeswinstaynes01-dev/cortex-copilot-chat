import { useState } from "react";
import type { ToolItem } from "../types";
import { IconChevron, IconTerminal } from "./Icons";

function preview(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const STATUS_LABEL: Record<ToolItem["status"], string> = {
  running: "running",
  done: "done",
  failed: "failed",
};

export default function ToolCallCard({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const args = preview(tool.args);

  return (
    <div className={`tool-card tool-card--${tool.status} ${open ? "tool-card--open" : ""}`}>
      <button
        type="button"
        className="tool-card__header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-card__icon">
          <IconTerminal size={14} />
        </span>
        <span className="tool-card__name">{tool.toolTitle || tool.toolName}</span>
        <span className={`chip chip--${tool.status}`}>{STATUS_LABEL[tool.status]}</span>
        <span className="tool-card__chevron" aria-hidden="true">
          <IconChevron size={14} />
        </span>
      </button>

      {/*
        Always rendered so the 0fr -> 1fr grid transition has something to
        animate; the wrapper clips it while collapsed.
      */}
      <div className="tool-card__wrap">
        <div>
          <div className="tool-card__body">
            {args && (
              <>
                <div className="tool-card__label">Arguments</div>
                <pre>{args}</pre>
              </>
            )}
            {tool.result && (
              <>
                <div className="tool-card__label">Result</div>
                <pre>
                  {tool.result.length > 4000 ? `${tool.result.slice(0, 4000)}…` : tool.result}
                </pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
