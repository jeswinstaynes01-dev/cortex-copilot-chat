import type { SessionSummary } from "./types";

const BASE = "/api/sessions";

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Response had no JSON body; keep the status text.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  /*
   * Several endpoints reply 202/205 with no body. `response.json()` throws
   * "Unexpected end of JSON input" on an empty body, which previously surfaced
   * as a spurious error banner after every successful send — read the text
   * first and only parse when there is something to parse.
   */
  const text = await response.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export async function listSessions(): Promise<SessionSummary[]> {
  return handle(await fetch(BASE));
}

export async function createSession(input: {
  model?: string;
  workingDirectory?: string;
  autoApprove?: boolean;
}): Promise<SessionSummary> {
  return handle(
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteSession(id: string): Promise<void> {
  return handle(await fetch(`${BASE}/${id}`, { method: "DELETE" }));
}

export async function sendMessage(id: string, prompt: string): Promise<void> {
  return handle(
    await fetch(`${BASE}/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    }),
  );
}

export async function abortTurn(id: string): Promise<void> {
  return handle(await fetch(`${BASE}/${id}/abort`, { method: "POST" }));
}

export async function decidePermission(
  sessionId: string,
  requestId: string,
  decision: "approve" | "reject",
  feedback?: string,
): Promise<void> {
  return handle(
    await fetch(`${BASE}/${sessionId}/permissions/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, feedback }),
    }),
  );
}

export function eventStreamUrl(sessionId: string): string {
  return `${BASE}/${sessionId}/events`;
}
