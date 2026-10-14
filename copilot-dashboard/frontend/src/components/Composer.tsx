import { useState } from "react";
import { IconSend, IconStop } from "./Icons";

interface Props {
  disabled: boolean;
  busy: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
}

export default function Composer({ disabled, busy, onSend, onStop }: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  const submit = () => {
    const prompt = value.trim();
    if (!prompt || disabled) return;
    onSend(prompt);
    setValue("");
  };

  return (
    <div className={`composer ${focused ? "composer--focused" : ""}`}>
      <div className="composer__field">
        <textarea
          value={value}
          rows={1}
          placeholder={
            disabled ? "Agent is working…" : "Ask Copilot…  ⏎ send  ·  ⇧⏎ new line"
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <span className="composer__beam" aria-hidden="true" />
      </div>

      {busy ? (
        <button type="button" className="btn btn--stop" onClick={onStop}>
          <IconStop size={13} />
          <span className="btn__text">Stop</span>
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary"
          disabled={disabled || !value.trim()}
          onClick={submit}
        >
          <span className="btn__text">Send</span>
          <IconSend size={15} />
        </button>
      )}
    </div>
  );
}
