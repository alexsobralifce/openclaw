// Notas em lista no Postgres. Toda consulta filtra por workspaceId.

import { prisma } from "@openclaw/database";
import { openField, sealField } from "../../webhooks/crypto";
import { cleanNoteTitle, NoteItem, sanitizeItems } from "./list-notes";

export interface ListNoteRow {
  id: string;
  title: string;
  items: NoteItem[];
  remindAt: Date | null;
  remindedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Título e itens ficam cifrados (os itens, como um JSON em texto); o horário do lembrete fica aberto para o agendador achar os vencidos.
// Linhas antigas, com os itens como lista JSON e o título em texto puro, continuam legíveis.
export const sealItems = (items: NoteItem[], workspaceId: string) => sealField(JSON.stringify(items), workspaceId);

function openItems(raw: unknown, workspaceId: string): NoteItem[] {
  if (typeof raw !== "string") return sanitizeItems(raw);
  try {
    return sanitizeItems(JSON.parse(openField(raw, workspaceId)));
  } catch {
    return [];
  }
}

export const openNoteRow = (r: any): ListNoteRow => ({ id: r.id, title: openField(r.title, r.workspaceId), items: openItems(r.items, r.workspaceId), remindAt: r.remindAt ?? null, remindedAt: r.remindedAt ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt });

/** Mais recentes primeiro (a última alterada sobe). */
export async function listNotes(workspaceId: string, take = 200): Promise<ListNoteRow[]> {
  return (await prisma.listNote.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, take })).map(openNoteRow);
}

export async function getNote(workspaceId: string, id: string): Promise<ListNoteRow | null> {
  const r = await prisma.listNote.findFirst({ where: { id, workspaceId } });
  return r ? openNoteRow(r) : null;
}

export async function createNote(workspaceId: string, title: string, items: NoteItem[] = []): Promise<ListNoteRow> {
  return openNoteRow(await prisma.listNote.create({ data: { workspaceId, title: sealField(cleanNoteTitle(title) || "Nota", workspaceId), items: sealItems(sanitizeItems(items), workspaceId) } }));
}

/** Muda título, itens e/ou lembrete. Trocar o horário do lembrete o rearma (zera o "já enviado"). Devolve a nota, ou null se não é deste workspace. */
export async function updateNote(workspaceId: string, id: string, patch: { title?: string; items?: NoteItem[]; remindAt?: Date | null }): Promise<ListNoteRow | null> {
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = sealField(cleanNoteTitle(patch.title) || "Nota", workspaceId);
  if (patch.items !== undefined) data.items = sealItems(sanitizeItems(patch.items), workspaceId);
  if (patch.remindAt !== undefined) {
    data.remindAt = patch.remindAt;
    data.remindedAt = null;
  }
  const r = await prisma.listNote.updateMany({ where: { id, workspaceId }, data });
  return r.count ? getNote(workspaceId, id) : null;
}

export async function deleteNote(workspaceId: string, id: string): Promise<boolean> {
  return (await prisma.listNote.deleteMany({ where: { id, workspaceId } })).count > 0;
}

/** Lembretes que já passaram da hora e ainda não foram enviados (de todos os workspaces: é o agendador quem chama). */
export async function dueReminders(now: Date, take = 50): Promise<(ListNoteRow & { workspaceId: string })[]> {
  const rows = await prisma.listNote.findMany({ where: { remindAt: { lte: now }, remindedAt: null }, orderBy: { remindAt: "asc" }, take });
  return rows.map((r) => ({ ...openNoteRow(r), workspaceId: r.workspaceId }));
}

/** Reserva o envio: só uma instância consegue marcar (a que marcou envia). O horário precisa ser o mesmo que foi lido. */
export async function claimReminder(id: string, remindAt: Date, now: Date): Promise<boolean> {
  return (await prisma.listNote.updateMany({ where: { id, remindAt, remindedAt: null }, data: { remindedAt: now } })).count > 0;
}
