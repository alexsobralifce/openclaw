import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { prisma } from "@openclaw/database";
import type { WsNewMessage, WsConversationUpdated, WsConversationDeleted } from "@openclaw/types";

@WebSocketGateway({
  cors: { origin: process.env.WEB_URL || "http://localhost:3000", credentials: true },
  namespace: "/inbox",
})
export class InboxGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(InboxGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("sem token");
      const payload: any = this.jwt.verify(token);
      const member = await prisma.workspaceMember.findFirst({ where: { userId: payload.sub } });
      if (!member) throw new Error("sem workspace");
      client.data.workspaceId = member.workspaceId;
      client.join(`workspace:${member.workspaceId}`);
    } catch (err: any) {
      this.logger.warn(`Conexão WebSocket recusada: ${err.message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage("join:conversation")
  async joinConversation(@ConnectedSocket() client: Socket, @MessageBody() conversationId: string) {
    const workspaceId = client.data.workspaceId as string | undefined;
    if (!workspaceId || typeof conversationId !== "string") return;
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
    if (conv) client.join(`conversation:${conversationId}`);
  }

  emitNewMessage(workspaceId: string, payload: WsNewMessage) {
    this.server.to(`workspace:${workspaceId}`).emit("message:new", payload);
  }

  emitConversationUpdated(workspaceId: string, payload: WsConversationUpdated) {
    this.server.to(`workspace:${workspaceId}`).emit("conversation:updated", payload);
  }

  emitConversationDeleted(workspaceId: string, payload: WsConversationDeleted) {
    this.server.to(`workspace:${workspaceId}`).emit("conversation:deleted", payload);
  }
}
