import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";

/** Dados do usuário que podem sair na API (nunca passwordHash). */
const PUBLIC_USER = { id: true, name: true, email: true, avatarUrl: true } as const;

@Injectable()
export class WorkspaceService {
  getWorkspace(id: string) {
    return prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: { users: { include: { user: { select: PUBLIC_USER } } } },
    });
  }

  /** Só o nome pode ser alterado por aqui: plano, slug e os demais campos do corpo são ignorados. */
  updateWorkspace(id: string, body: any) {
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (!name) throw new BadRequestException("Nome do workspace inválido");
    return prisma.workspace.update({ where: { id }, data: { name } });
  }

  inviteMember(workspaceId: string, userId: string, role: "AGENT" | "ADMIN") {
    return prisma.workspaceMember.create({
      data: { workspaceId, userId, role },
    });
  }
}
