import { useState } from "react";
import type { PermissionPrompt as Prompt } from "../types";
import { IconAlert, IconShield } from "./Icons";

interface Props {
  prompt: Prompt;
  onDecide: (requestId: string, decision: "approve" | "reject", feedback?: string) => void;
}

interface Summary {
  title: string;
  detail: string;
  intention?: string;
  flags: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Pulls a human-friendly summary out of the SDK permission payload, whose observed
 * shape is `{ kind, toolCallId, extensionData }`. `extensionData` varies per kind —
 * shell requests carry fullCommandText/shellType/intention/commands, while file and
 * network requests surface possiblePaths/possibleUrls. Unknown kinds fall back to raw JSON.
 */
function summarize(request: Record<string, unknown>): Summary {
  const kind = typeof request.kind === "string" ? request.kind : "action";
  const ext = asRecord(request.extensionData);

  const command = typeof ext.fullCommandText === "string" ? ext.fullCommandText : "";
  const shellType = typeof ext.shellType === "string" ? ext.shellType : "";
  const intention = typeof ext.intention === "string" ? ext.intention : undefined;
  const paths = asStringList(ext.possiblePaths);
  const urls = asStringList(ext.possibleUrls);

  const detail = command || paths.join("\n") || urls.join("\n") || JSON.stringify(request, null, 2);

  const flags: string[] = [];
  const writes = Array.isArray(ext.commands)
    ? ext.commands.filter((entry) => asRecord(entry).readOnly === false).length
    : 0;
  if (writes > 0) {
    flags.push(`${writes} command${writes > 1 ? "s" : ""} may modify state`);
  }
  if (ext.hasWriteFileRedirection === true) {
    flags.push("redirects output to a file");
  }
  if (urls.length > 0) {
    flags.push("accesses the network");
  }

  return { title: shellType ? `${kind} · ${shellType}` : kind, detail, intention, flags };
}

export default function PermissionPrompt({ prompt, onDecide }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const { title, detail, intention, flags } = summarize(prompt.request);

  return (
    <div className="permission">
      <div className="permission__head">
        <span className="permission__icon">
          <IconShield size={15} />
        </span>
        <span className="permission__title">Permission required</span>
        <span className="chip chip--warn">{title}</span>
      </div>

      {intention && <p className="permission__intention">{intention}</p>}

      <pre className="permission__detail">{detail}</pre>

      {flags.length > 0 && (
        <ul className="permission__flags">
          {flags.map((flag) => (
            <li key={flag}>
              <IconAlert size={13} />
              <span>{flag}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="permission__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => onDecide(prompt.requestId, "approve")}
        >
          <span className="btn__text">Approve once</span>
        </button>
        <button
          type="button"
          className="btn btn--danger btn--sm"
          onClick={() => onDecide(prompt.requestId, "reject")}
        >
          <span className="btn__text">Reject</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setShowRaw((value) => !value)}
        >
          <span className="btn__text">{showRaw ? "Hide" : "Show"} raw</span>
        </button>
      </div>

      {showRaw && <pre className="permission__raw">{JSON.stringify(prompt.request, null, 2)}</pre>}
    </div>
  );
}
