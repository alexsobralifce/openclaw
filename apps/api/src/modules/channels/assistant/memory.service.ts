import { Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";

const MAX_PER_WORKSPACE = 100;

@Injectable()
export class MemoryService {
  list(workspaceId: string, take = 40) {
    return prisma.memory.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take });
  }

  async add(workspaceId: string, content: string, kind = "fact") {
    const text = content.trim().slice(0, 300);
    if (!text) throw new Error("memória vazia");
    const dup = await prisma.memory.findFirst({ where: { workspaceId, content: text } });
    if (dup) return dup;
    const total = await prisma.memory.count({ where: { workspaceId } });
    if (total >= MAX_PER_WORKSPACE) {
      const oldest = await prisma.memory.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
      if (oldest) await prisma.memory.delete({ where: { id: oldest.id } });
    }
    return prisma.memory.create({ data: { workspaceId, content: text, kind } });
  }

  async remove(workspaceId: string, id: string) {
    await prisma.memory.deleteMany({ where: { id, workspaceId } });
  }

  async promptBlock(workspaceId: string) {
    const items = await this.list(workspaceId, 30);
    if (!items.length) return "";
    return `Memórias salvas pelo dono (preferências e fatos; use para personalizar):\n${items.map((m) => `- ${m.content}`).join("\n")}`;
  }
}
