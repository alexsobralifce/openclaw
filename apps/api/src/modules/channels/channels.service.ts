import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@openclaw/database";

@Injectable()
export class ChannelsService {
  async listChannels(workspaceId: string) {
    return prisma.channel.findMany({ where: { workspaceId } });
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
