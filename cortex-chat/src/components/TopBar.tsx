import { useState } from "react";
import type { ClientSettings, Conversation, McpServer, ModelOption, Persona } from "../lib/types";
import { copyText, download, slug, toMarkdown } from "../lib/transcript";
import { ripple } from "../lib/ripple";
import { ModelMenu } from "./ModelMenu";
import { Icon } from "./Icons";

interface Props {
  label: string;
  settings: ClientSettings | null;
  conversation: Conversation | null;
  busy: boolean;
  loadModels: () => Promise<ModelOption[]>;
  personas: Persona[] | null;
  loadMcpServers: () => Promise<McpServer[]>;
  onConfigure: (patch: Partial<ClientSettings>) => void;
  onOpenMenu: () => void;
}

/* Everything in this bar now does something. The previous version carried a
   "More" overflow, a "Copy link" that had no link to copy and an "Upgrade"
   button for a product with no paid tier — three controls whose only job was
   to look like a real app. */
export function TopBar({
  label,
  settings,
  conversation,
  busy,
  loadModels,
  personas,
  loadMcpServers,
  onConfigure,
  onOpenMenu,
}: Props) {
  const [copied, setCopied] = useState(false);
  const has = (conversation?.messages.length ?? 0) > 0;

  const onCopy = async () => {
    if (!conversation) return;
    if (await copyText(toMarkdown(conversation))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const onExport = () => {
    if (!conversation) return;
    download(`${slug(conversation.title)}.md`, toMarkdown(conversation));
  };

  return (
    <header className="topbar">
      <button
        className="iconbtn topbar__menu"
        onClick={onOpenMenu}
        aria-label="Open menu"
        aria-controls="rail"
      >
        <Icon name="menu" size={20} />
      </button>

      <ModelMenu
        label={label}
        settings={settings}
        loadModels={loadModels}
        personas={personas}
        loadMcpServers={loadMcpServers}
        onConfigure={onConfigure}
        busy={busy}
      />

      <div className="topbar__spacer" />

      <div className="topbar__actions">
        {/* Disabled rather than hidden: a control that vanishes and reappears
            makes the row jump, and the disabled state explains why it is
            unavailable instead of leaving the user to guess. */}
        <button
          className="iconbtn iconbtn--bordered"
          aria-label="Copy transcript"
          data-tip={copied ? "Copied" : "Copy transcript"}
          data-tip-below
          disabled={!has}
          onClick={onCopy}
        >
          <Icon name={copied ? "check" : "copy"} size={17} />
        </button>
        <button
          className="btn btn--ghost topbar__wide ripple-host"
          onPointerDown={ripple}
          disabled={!has}
          onClick={onExport}
        >
          <Icon name="export" size={17} />
          Export chat
        </button>
      </div>
    </header>
  );
}
