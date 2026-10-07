import { Injectable } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { openField, sealField } from "../../webhooks/crypto";
import { encodeRoutine, MAX_ROUTINE, parseRoutine, RoutineItem, topicKey, when } from "./routine";

const MAX_PER_WORKSPACE = 100;

@Injectable()
export class MemoryService {
  /** Memórias comuns (a rotina tem lista própria). */
  async list(workspaceId: string, take = 40) {
    const rows = await prisma.memory.findMany({ where: { workspaceId, kind: { not: "routine" } }, orderBy: { createdAt: "desc" }, take });
    return rows.map((r) => ({ ...r, content: openField(r.content, workspaceId) }));
  }

  async add(workspaceId: string, content: string, kind = "fact") {
    const text = content.trim().slice(0, 300);
    if (!text) throw new Error("memória vazia");
    // O texto é cifrado com IV aleatório, então a duplicata se acha comparando o conteúdo já decifrado
    const dup = (await this.list(workspaceId, MAX_PER_WORKSPACE)).find((m) => m.content === text);
    if (dup) return dup;
    // O teto vale só para memórias comuns: a rotina tem o próprio limite e nunca é descartada por aqui
    const common = { workspaceId, kind: { not: "routine" } };
    const total = await prisma.memory.count({ where: common });
    if (total >= MAX_PER_WORKSPACE) {
      const oldest = await prisma.memory.findFirst({ where: common, orderBy: { createdAt: "asc" } });
      if (oldest) await prisma.memory.delete({ where: { id: oldest.id } });
    }
    const created = await prisma.memory.create({ data: { workspaceId, content: sealField(text, workspaceId), kind } });
    return { ...created, content: text };
  }

  async remove(workspaceId: string, id: string) {
    await prisma.memory.deleteMany({ where: { id, workspaceId } });
  }

  // ─── Rotina: compromissos e hábitos recorrentes, sempre atualizáveis ───

  async listRoutine(workspaceId: string): Promise<(RoutineItem & { id: string })[]> {
    const rows = await prisma.memory.findMany({ where: { workspaceId, kind: "routine" }, orderBy: { createdAt: "asc" }, take: MAX_ROUTINE });
    return rows.flatMap((r) => {
      const item = parseRoutine(openField(r.content, workspaceId));
      return item ? [{ ...item, id: r.id }] : [];
    });
  }

  /** Cria ou substitui o item do mesmo tema (é assim que a rotina é atualizada). */
  async setRoutine(workspaceId: string, item: RoutineItem): Promise<{ updated: boolean }> {
    const current = await this.listRoutine(workspaceId);
    const same = current.find((r) => topicKey(r.topic) === topicKey(item.topic));
    if (same) {
      await prisma.memory.updateMany({ where: { id: same.id, workspaceId }, data: { content: sealField(encodeRoutine(item), workspaceId) } });
      return { updated: true };
    }
    if (current.length >= MAX_ROUTINE) throw new Error(`a rotina já tem ${MAX_ROUTINE} itens; remova algum antes`);
    await prisma.memory.create({ data: { workspaceId, kind: "routine", content: sealField(encodeRoutine(item), workspaceId) } });
    return { updated: false };
  }

  /** Remove por tema (ou pelo id, como na tela da rotina). Devolve se algo foi removido. */
  async removeRoutine(workspaceId: string, topicOrId: string): Promise<boolean> {
    const current = await this.listRoutine(workspaceId);
    const hit = current.find((r) => r.id === topicOrId || topicKey(r.topic) === topicKey(topicOrId));
    if (!hit) return false;
    await prisma.memory.deleteMany({ where: { id: hit.id, workspaceId } });
    return true;
  }

  async promptBlock(workspaceId: string) {
    const items = await this.list(workspaceId, 30);
    const routine = await this.listRoutine(workspaceId);
    const parts: string[] = [];
    if (routine.length) {
      parts.push(`Rotina do dono (compromissos e hábitos recorrentes; considere ao sugerir horários e prazos. Se ele disser que algo mudou, atualize com routine_set usando o mesmo tema):\n${routine.map((r) => `- ${r.topic}${when(r) ? ` (${when(r)})` : ""}: ${r.description}`).join("\n")}`);
    }
    if (items.length) parts.push(`Memórias salvas pelo dono (preferências e fatos; use para personalizar):\n${items.map((m) => `- ${m.content}`).join("\n")}`);
    return parts.join("\n\n");
  }
}
