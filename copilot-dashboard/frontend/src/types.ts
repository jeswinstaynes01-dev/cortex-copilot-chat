export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  workingDirectory: string;
  autoApprove: boolean;
  busy: boolean;
  createdAt: string;
  lastActivityAt: string;
}

/** Every event the backend pushes over SSE has this envelope. */
export interface CopilotEvent {
  type: string;
  timestamp: number;
  data?: Record<string, unknown>;
  // Fields the backend adds directly on dashboard.* events.
  content?: string;
  message?: string;
  requestId?: string;
  request?: Record<string, unknown>;
  busy?: boolean;
}

export interface UserItem {
  kind: "user";
  id: string;
  text: string;
}

export interface AssistantItem {
  kind: "assistant";
  id: string;
  text: string;
  streaming: boolean;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  toolName: string;
  toolTitle?: string;
  args?: unknown;
  status: "running" | "done" | "failed";
  result?: string;
}

export interface ErrorItem {
  kind: "error";
  id: string;
  message: string;
}

/** Neutral inline note — e.g. "turn stopped by user". Not a failure. */
export interface NoticeItem {
  kind: "notice";
  id: string;
  message: string;
}

export type ChatItem = UserItem | AssistantItem | ToolItem | ErrorItem | NoticeItem;

export interface PermissionPrompt {
  requestId: string;
  request: Record<string, unknown>;
}

export interface UsageInfo {
  currentTokens?: number;
  tokenLimit?: number;
  messagesLength?: number;
}

/** One raw runtime event, kept for the inspector pane. */
export interface LoggedEvent {
  seq: number;
  type: string;
  timestamp: number;
  payload: unknown;
}
