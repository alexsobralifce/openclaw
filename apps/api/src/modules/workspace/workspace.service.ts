import { Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";

@Injectable()
export class WorkspaceService {
  getWorkspace(id: string) {
    return prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: { users: { include: { user: true } } },
    });
  }

  updateWorkspace(id: string, data: Partial<{ name: string }>) {
    return prisma.workspace.update({ where: { id }, data });
  }

  inviteMember(workspaceId: string, userId: string, role: "AGENT" | "ADMIN") {
    return prisma.workspaceMember.create({
      data: { workspaceId, userId, role },
    });
  }
}
