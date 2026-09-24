// ─── WebSocket events ────────────────────────────────────────────

export interface WsNewMessage {
  conversationId: string;
  message: {
    id: string;
    body: string;
    type: string;
    direction: "INBOUND" | "OUTBOUND";
    createdAt: string;
    authorId: string | null;
  };
}

export interface WsConversationUpdated {
  conversationId: string;
  status: string;
  assigneeIds: string[];
}

export interface WsAgentPresence {
  userId: string;
  online: boolean;
}

// ─── Channel message (normalized) ────────────────────────────────

export interface IncomingMessage {
  channelId: string;
  workspaceId: string;
  externalId: string;
  from: string;
  body: string;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "FILE";
  mediaUrl?: string;
  timestamp: Date;
  raw: unknown;
}

// ─── Pagination ───────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

// ─── API responses ────────────────────────────────────────────────

export interface ApiError {
  message: string;
  code: string;
  statusCode: number;
}
