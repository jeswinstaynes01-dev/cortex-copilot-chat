import { useState } from "react";
import { IconClose, IconPlus } from "./Icons";

export interface ModelOption {
  id: string;
  name: string;
}

interface Props {
  defaultWorkingDirectory: string;
  models: ModelOption[];
  busy: boolean;
  presenceClass: string;
  onCreate: (input: { model: string; workingDirectory: string; autoApprove: boolean }) => void;
  onCancel: () => void;
}

export default function NewSessionForm({
  defaultWorkingDirectory,
  models,
  busy,
  presenceClass,
  onCreate,
  onCancel,
}: Props) {
  const [model, setModel] = useState("auto");
  const [workingDirectory, setWorkingDirectory] = useState(defaultWorkingDirectory);
  const [autoApprove, setAutoApprove] = useState(false);

  return (
    <div className={`modal-backdrop ${presenceClass}`} onClick={onCancel}>
      <form
        className="modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({ model, workingDirectory, autoApprove });
        }}
      >
        <header className="modal__head">
          <div>
            <span className="eyebrow">Deploy</span>
            <h2 className="modal__title">New session</h2>
          </div>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Close"
            onClick={onCancel}
          >
            <IconClose size={15} />
          </button>
        </header>

        <label className="field">
          <span className="field__label">Model</span>
          <select
            className="field__control"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Working directory</span>
          <input
            className="field__control field__control--mono"
            value={workingDirectory}
            onChange={(event) => setWorkingDirectory(event.target.value)}
            placeholder="C:\Users\you\IdeaProjects\my-repo"
          />
          <small className="field__hint">
            The agent reads and edits files relative to this folder.
          </small>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(event) => setAutoApprove(event.target.checked)}
          />
          <span className="checkbox__box" aria-hidden="true" />
          <span className="checkbox__text">
            Auto-approve tool calls
            <small>Skips the permission prompts for this session.</small>
          </span>
        </label>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            <span className="btn__text">Cancel</span>
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            <IconPlus size={15} />
            <span className="btn__text">{busy ? "Creating…" : "Create"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
