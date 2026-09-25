import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@openclaw/database";

@Injectable()
export class ChannelsService {
  /** Só o que o painel precisa: o `config` guarda tokens e chaves e nunca vai para o navegador. */
  async listChannels(workspaceId: string) {
    const rows = await prisma.channel.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    return rows.map((c) => {
      const cfg = (c.config ?? {}) as any;
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        isActive: c.isActive,
        createdAt: c.createdAt,
        workspaceId: c.workspaceId,
        config: { ...(cfg.provider ? { provider: cfg.provider } : {}), ...(cfg.email ? { email: cfg.email } : {}), ...(cfg.instanceName ? { instanceName: cfg.instanceName } : {}) },
      };
    });
  }

  async getChannelByWebhookToken(token: string) {
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: token } });
    if (!apiKey) throw new NotFoundException("Invalid webhook token");
    return apiKey.workspaceId;
  }

  async createChannel(workspaceId: string, name: string, type: string, config: object) {
    return prisma.channel.create({
      data: { workspaceId, name, type: type as any, config },
    });
  }
}
