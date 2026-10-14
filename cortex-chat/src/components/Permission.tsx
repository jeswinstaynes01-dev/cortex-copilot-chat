import { useState } from "react";
import type { PermissionDecision, PermissionRequest } from "../lib/types";
import { ripple } from "../lib/ripple";
import { Icon } from "./Icons";

interface Props {
  request: PermissionRequest;
  onDecide: (id: string, decision: PermissionDecision) => void;
}

/**
 * The agent blocks here. The backend holds the turn open waiting for a
 * decision and gives up after `permissionTimeoutSeconds` (600 by default), so
 * this card is not an optional nicety — without it, every file write or shell
 * command appears to hang for ten minutes and then quietly fails.
 */
export function Permission({ request, onDecide }: Props) {
  const [raw, setRaw] = useState(false);

  return (
    <div className="perm" role="alertdialog" aria-label="Permission required">
      <div className="perm__head">
        <span className="perm__icon">
          <Icon name="shield" size={15} />
        </span>
        <span className="perm__title">Permission required</span>
        <span className="perm__kind">{request.title}</span>
      </div>

      {request.detail && <pre className="perm__detail">{request.detail}</pre>}

      <div className="perm__actions">
        <button
          className="btn btn--dark btn--sm ripple-host"
          onPointerDown={ripple}
          onClick={() => onDecide(request.id, "approve")}
          autoFocus
        >
          <Icon name="check" size={15} />
          Approve once
        </button>
        <button
          className="btn btn--danger btn--sm ripple-host"
          onPointerDown={ripple}
          onClick={() => onDecide(request.id, "reject")}
        >
          <Icon name="close" size={14} />
          Reject
        </button>
        {request.raw && (
          <button className="btn btn--ghost btn--sm" onClick={() => setRaw((v) => !v)}>
            {raw ? "Hide" : "Show"} raw
          </button>
        )}
      </div>

      {raw && request.raw && <pre className="perm__raw scroller">{request.raw}</pre>}
    </div>
  );
}
