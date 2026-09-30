import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";

@Injectable()
export class WorkspaceService {
  getWorkspace(id: string) {
    return prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: {
        users: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        },
      },
    });
  }

  updateWorkspace(id: string, data: Partial<{ name: string }>) {
    // Só o nome é editável; o resto (plano, slug) não pode vir do corpo da requisição
    const name = typeof data?.name === "string" ? data.name.trim().slice(0, 100) : "";
    if (!name) throw new BadRequestException("Informe o nome do workspace");
    return prisma.workspace.update({ where: { id }, data: { name } });
  }

  inviteMember(workspaceId: string, userId: string, role: "AGENT" | "ADMIN") {
    return prisma.workspaceMember.create({
      data: { workspaceId, userId, role },
    });
  }
}
