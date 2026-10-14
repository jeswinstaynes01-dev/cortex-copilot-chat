import { useEffect, useRef } from "react";
import type { ChatItem } from "../types";
import ToolCallCard from "./ToolCallCard";

export default function MessageList({ items }: { items: ChatItem[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  return (
    <div className="messages">
      {items.length === 0 && (
        <p className="messages__hint">Ask Copilot something to get started.</p>
      )}

      {items.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <div key={item.id} className="turn turn--user">
                <span className="turn__who">You</span>
                <div className="bubble bubble--user">{item.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={item.id} className="turn turn--assistant">
                <span className="turn__who">Copilot</span>
                <div className="bubble bubble--assistant">
                  {item.text}
                  {item.streaming && <span className="caret" />}
                </div>
              </div>
            );
          case "tool":
            return <ToolCallCard key={item.id} tool={item} />;
          case "error":
            return (
              <div key={item.id} className="bubble bubble--error">
                {item.message}
              </div>
            );
          case "notice":
            return (
              <div key={item.id} className="notice">
                {item.message}
              </div>
            );
        }
      })}

      <div ref={bottomRef} />
    </div>
  );
}
