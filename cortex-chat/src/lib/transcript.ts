import type { Conversation, Message } from "./types";

/* Markdown, not JSON or plain text: it survives a paste into a ticket, a PR
   description or a doc with its structure intact, and the assistant's replies
   are already markdown so they need no conversion at all. */

function renderMessage(m: Message): string {
  const head = m.role === "user" ? "### You" : "### Cortex";
  const parts = [head];

  if (m.tools.length > 0) {
    parts.push(
      m.tools
        .map((t) => {
          const mark = t.status === "failed" ? "✗" : t.status === "done" ? "✓" : "…";
          return `- ${mark} \`${t.title ?? t.name}\`${t.detail ? ` — ${t.detail}` : ""}`;
        })
        .join("\n"),
    );
  }

  if (m.text.trim()) parts.push(m.text.trim());
  if (m.notice) parts.push(`> ${m.notice}`);

  return parts.join("\n\n");
}

export function toMarkdown(conversation: Conversation): string {
  const when = new Date(conversation.updatedAt).toISOString().slice(0, 16).replace("T", " ");
  const body = conversation.messages.map(renderMessage).join("\n\n---\n\n");
  return `# ${conversation.title}\n\n_Exported from Cortex · ${when}_\n\n${body}\n`;
}

/* Browsers will not let a page write to disk, so the only route is an anchor
   pointed at an in-memory blob. The object URL is revoked immediately after;
   it is already queued for download by then, and leaving it alive pins the
   whole transcript in memory for the life of the document. */
export function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe, lowercase, no runs of dashes. */
export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "cortex-chat"
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Clipboard access is refused without a user gesture, and on http origins
       other than localhost. Report it rather than pretending it worked. */
    return false;
  }
}
