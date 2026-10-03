import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { prisma } from "@openclaw/database";
import { webOrigins } from "../../../web-origins";

/** Tempo real do chat do app: cada usuário entra na própria sala e recebe só as mensagens dele. */
@WebSocketGateway({
  cors: { origin: webOrigins(), credentials: true },
  namespace: "/chat",
})
export class AppChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(AppChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("sem token");
      const payload: any = this.jwt.verify(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true } });
      if (!user || user.status !== "ACTIVE") throw new Error("conta inativa");
      client.join(`user:${payload.sub}`);
    } catch (err: any) {
      this.logger.warn(`Conexão do chat recusada: ${err.message}`);
      client.disconnect(true);
    }
  }

  emit(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** O usuário está com o app aberto agora? (Se estiver, não precisa de notificação push.) */
  async online(userId: string): Promise<boolean> {
    try {
      return ((await this.server?.in(`user:${userId}`).fetchSockets()) ?? []).length > 0;
    } catch {
      return false;
    }
  }
}
