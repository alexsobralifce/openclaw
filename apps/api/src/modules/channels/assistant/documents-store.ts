// Catálogo de documentos no Postgres. Toda consulta filtra por workspaceId; a unicidade de (workspaceId, driveFileId) é garantida aqui,
// porque `@unique` em coluna nova trava o `prisma db push` de produção.

import { prisma } from "@magobox/database";
import { DocFields, sanitizeTags } from "./documents";
import { cleanTitle, cleanTopic } from "./notes";

export interface NewDocument extends DocFields {
  workspaceId: string;
  /** pdf = arquivo guardado no Drive; nota = nota antiga reclassificada (não há PDF original) */
  kind?: "pdf" | "nota";
  driveFileId: string;
  account: string;
  mime?: string;
  sizeBytes?: number;
  pages?: number | null;
  origin?: string;
}

/** Cria a ficha; se esse arquivo do Drive já está no catálogo, atualiza a existente em vez de duplicar. */
export async function createDocument(d: NewDocument) {
  const data = {
    kind: d.kind ?? "pdf",
    title: d.title.slice(0, 120),
    topic: d.topic.slice(0, 60),
    tags: sanitizeTags(d.tags),
    summary: d.summary.slice(0, 500),
    driveFileId: d.driveFileId,
    account: d.account,
    mime: d.mime ?? "application/pdf",
    sizeBytes: Math.max(0, Math.trunc(d.sizeBytes ?? 0)),
    pages: d.pages ?? null,
    origin: d.origin ?? "whatsapp",
  };
  const existing = await prisma.document.findFirst({ where: { workspaceId: d.workspaceId, driveFileId: d.driveFileId } });
  if (existing) return prisma.document.update({ where: { id: existing.id }, data });
  return prisma.document.create({ data: { ...data, workspaceId: d.workspaceId } });
}

/** Do mais novo ao mais antigo; o catálogo é pequeno, então a busca por texto roda em memória (documents.ts). */
export const listDocuments = (workspaceId: string, take = 500) => prisma.document.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take });

export const getDocument = (workspaceId: string, id: string) => prisma.document.findFirst({ where: { id, workspaceId } });

/** Troca as tags (sempre limpas, sem repetir, no máximo 8). Devolve a ficha atualizada, ou null se não é deste workspace. */
export async function setDocumentTags(workspaceId: string, id: string, tags: string[]) {
  const r = await prisma.document.updateMany({ where: { id, workspaceId }, data: { tags: sanitizeTags(tags) } });
  return r.count ? getDocument(workspaceId, id) : null;
}

/** Muda título, assunto e/ou tags pelo painel (limpos e com tamanho máximo). Devolve a ficha atualizada, ou null se não é deste workspace. */
export async function updateDocument(workspaceId: string, id: string, patch: { title?: string; topic?: string; tags?: string[] }) {
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = cleanTitle(patch.title, "Documento");
  if (patch.topic !== undefined) data.topic = cleanTopic(patch.topic);
  if (patch.tags !== undefined) data.tags = sanitizeTags(patch.tags);
  if (!Object.keys(data).length) return getDocument(workspaceId, id);
  const r = await prisma.document.updateMany({ where: { id, workspaceId }, data });
  return r.count ? getDocument(workspaceId, id) : null;
}

/** Muda a categoria (o campo `topic`) de vários documentos de uma vez; devolve quantos mudaram. */
export async function setDocumentsTopic(workspaceId: string, ids: string[], topic: string): Promise<number> {
  if (!ids.length) return 0;
  return (await prisma.document.updateMany({ where: { id: { in: ids }, workspaceId }, data: { topic: cleanTopic(topic) } })).count;
}

export async function deleteDocument(workspaceId: string, id: string): Promise<boolean> {
  return (await prisma.document.deleteMany({ where: { id, workspaceId } })).count > 0;
}

/** Já existe ficha para este arquivo do Drive? (a reclassificação não repete notas) */
export async function catalogedDriveIds(workspaceId: string): Promise<Set<string>> {
  const rows = await prisma.document.findMany({ where: { workspaceId }, select: { driveFileId: true } });
  return new Set(rows.map((r) => r.driveFileId));
}
