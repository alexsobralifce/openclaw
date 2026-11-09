// Categorias dos documentos: as dos próprios documentos (campo `topic`) mais as criadas à mão, que podem estar vazias.
// As criadas à mão ficam no estado (não há tabela de categorias). Usado pelo assistente e pelo painel, para os dois seguirem a mesma regra.

import { Logger } from "@nestjs/common";
import { categoriesStateKey, categoryKey, Category, cleanCategory, docsInCategory, MAX_CUSTOM_CATEGORIES, mergeCategories, NO_CATEGORY, topCategories } from "./documents";
import { listDocuments, setDocumentsTopic } from "./documents-store";

/** O que o Drive precisa para mover o PDF (o GoogleService cumpre). */
export interface DocFileMover {
  documentMove(workspaceId: string, fileId: string, category: string | undefined, account?: string): Promise<void>;
}

const moveLog = new Logger("Documentos");

/**
 * Leva o PDF para a pasta da categoria. Depois que a ficha mudou no banco: se o Drive falhar, a ficha continua mudada,
 * o erro fica no log e o arquivo segue onde estava. Notas antigas (kind "nota") não são movidas.
 */
export async function moveDocumentFile(mover: DocFileMover, ws: string, d: { kind?: string; driveFileId: string; account: string }, category: string): Promise<boolean> {
  if (d.kind && d.kind !== "pdf") return false;
  try {
    await mover.documentMove(ws, d.driveFileId, category, d.account);
    return true;
  } catch (e: any) {
    moveLog.warn(`Não consegui mover o arquivo ${d.driveFileId} para a pasta "${category || NO_CATEGORY}": ${e?.message ?? e}`);
    return false;
  }
}

/** Quantos PDFs de cada lote do "organizar pastas" (cada um é uma chamada ao Drive). */
export const ORGANIZE_BATCH = 50;

/** Manda um lote de PDFs (a partir de `offset`, do mais novo) para as pastas das categorias. Idempotente: quem já está no lugar não muda. */
export async function organizeDocumentsBatch(
  mover: DocFileMover,
  ws: string,
  offset: number,
): Promise<{ processed: number; moved: number; failed: number; nextOffset: number | null }> {
  const docs = await listDocuments(ws, 5000);
  const batch = docs.slice(offset, offset + ORGANIZE_BATCH);
  let moved = 0;
  let failed = 0;
  for (const d of batch) {
    if (d.kind !== "pdf") continue;
    if (await moveDocumentFile(mover, ws, d, d.topic)) moved++;
    else failed++;
  }
  const next = offset + batch.length;
  return { processed: batch.length, moved, failed, nextOffset: next < docs.length ? next : null };
}

export interface CategoryState {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}

export const customCategories = async (state: CategoryState, ws: string): Promise<string[]> => (await state.get<{ names: string[] }>(categoriesStateKey(ws)))?.names ?? [];

export async function allCategories(state: CategoryState, ws: string, docs?: { topic: string }[]): Promise<Category[]> {
  return mergeCategories(topCategories(docs ?? (await listDocuments(ws))), await customCategories(state, ws));
}

export type CreateCategoryResult = { ok: true; name: string } | { ok: false; reason: "short" | "fixed" | "exists" | "limit"; name?: string };

export async function createCategory(state: CategoryState, ws: string, raw: string): Promise<CreateCategoryResult> {
  const name = cleanCategory(raw);
  if (name.length < 2) return { ok: false, reason: "short" };
  if (categoryKey(name) === categoryKey(NO_CATEGORY)) return { ok: false, reason: "fixed" };
  const exists = (await allCategories(state, ws)).find((c) => categoryKey(c.name) === categoryKey(name));
  if (exists) return { ok: false, reason: "exists", name: exists.name };
  const custom = await customCategories(state, ws);
  if (custom.length >= MAX_CUSTOM_CATEGORIES) return { ok: false, reason: "limit" };
  await state.set(categoriesStateKey(ws), { names: [...custom, name] });
  return { ok: true, name };
}

/** Documento que saiu da categoria apagada: o controller leva o PDF para "Sem categoria". */
export interface MovedDoc {
  kind: string;
  driveFileId: string;
  account: string;
}

export type DeleteCategoryResult = { ok: true; name: string; moved: number; docs: MovedDoc[] } | { ok: false; reason: "fixed" | "notfound" };

/** Apaga a categoria; os documentos dela vão para "Sem categoria" (nunca são apagados). */
export async function deleteCategory(state: CategoryState, ws: string, name: string): Promise<DeleteCategoryResult> {
  const k = categoryKey(name);
  if (k === categoryKey(NO_CATEGORY)) return { ok: false, reason: "fixed" };
  const docs = await listDocuments(ws);
  const custom = await customCategories(state, ws);
  const inDocs = docsInCategory(docs, name);
  if (!inDocs.length && !custom.some((c) => categoryKey(c) === k)) return { ok: false, reason: "notfound" };
  await state.set(categoriesStateKey(ws), { names: custom.filter((c) => categoryKey(c) !== k) });
  const moved = await setDocumentsTopic(ws, inDocs.map((d) => d.id), NO_CATEGORY);
  return { ok: true, name, moved, docs: inDocs };
}
