import { Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";

@Injectable()
export class AutomationsService {
  list(workspaceId: string) {
    return prisma.automation.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  }

  create(workspaceId: string, name: string, trigger: object, actions: object) {
    return prisma.automation.create({ data: { workspaceId, name, trigger, actions } });
  }

  toggle(workspaceId: string, id: string, isActive: boolean) {
    return prisma.automation.updateMany({ where: { id, workspaceId }, data: { isActive } });
  }
}
