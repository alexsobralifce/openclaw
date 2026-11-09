// Categorias dos documentos: as dos próprios documentos (campo `topic`) mais as criadas à mão, que podem estar vazias.
// As criadas à mão ficam no estado (não há tabela de categorias). Usado pelo assistente e pelo painel, para os dois seguirem a mesma regra.

import { Logger } from "@nestjs/common";
import { categoriesStateKey, categoryKey, Category, cleanCategory, docsInCategory, MAX_CUSTOM_CATEGORIES, mergeCategories, NO_CATEGORY, topCategories } from "./documents";
import { listDocuments, setDocumentsTopic } from "./documents-store";

/** O que o Drive precisa para mover o PDF (o GoogleService cumpre). */
export interface DocFileMover {
  documentMove(workspaceId: string, fileId: string, category: string | undefined, account?: string, folders?: Map<string, string>): Promise<boolean>;
}

const moveLog = new Logger("Documentos");

/** "moved": foi para a pasta nova; "unchanged": já estava lá (ou não é PDF); "failed": o Drive recusou. */
export type MoveOutcome = "moved" | "unchanged" | "failed";

/**
 * Leva o PDF para a pasta da categoria. Depois que a ficha mudou no banco: se o Drive falhar, a ficha continua mudada,
 * o erro fica no log e o arquivo segue onde estava. Notas antigas (kind "nota") não são movidas.
 */
export async function moveDocumentFile(
  mover: DocFileMover,
  ws: string,
  d: { kind?: string; driveFileId: string; account: string },
  category: string,
  folders = new Map<string, string>(),
): Promise<MoveOutcome> {
  if (d.kind && d.kind !== "pdf") return "unchanged";
  try {
    return (await mover.documentMove(ws, d.driveFileId, category, d.account, folders)) ? "moved" : "unchanged";
  } catch (e: any) {
    moveLog.warn(`Não consegui mover o arquivo ${d.driveFileId} para a pasta "${category || NO_CATEGORY}": ${e?.message ?? e}`);
    return "failed";
  }
}

/**
 * Teto de PDFs que mudam por chamada do "organizar pastas": cada mudança custa ~6 a 7 chamadas ao Drive.
 * Falhas não contam aqui: só as mudanças feitas.
 */
export const ORGANIZE_BATCH = 50;

/**
 * Teto de PDFs visitados por chamada (mudados, falhos ou já no lugar). Cada visita custa 2 a 3 chamadas ao Drive,
 * e este teto garante que a chamada termina mesmo quando muitos PDFs falham. Cada chamada recomeça do índice 0.
 */
export const ORGANIZE_VISIT_LIMIT = 200;

/** Cursor do "organizar pastas" por workspace: índice do próximo PDF a visitar. */
const organizeCursorKey = (ws: string) => `docorganize:${ws}`;

const organizeLog = new Logger("Documentos");

/**
 * Organiza os PDFs nas pastas das categorias. Cada chamada continua do cursor gravado pela anterior, para que PDFs
 * já no lugar não prendam a fila. `unchecked` = PDFs que faltam visitar até o fim da lista (0 quando terminou).
 */
export async function organizeDocumentsBatch(
  mover: DocFileMover,
  state: CategoryState,
  ws: string,
): Promise<{ moved: number; failed: number; unchecked: number }> {
  const docs = (await listDocuments(ws, 5000)).filter((d) => d.kind === "pdf");
  const saved = (await state.get<{ next: number }>(organizeCursorKey(ws)))?.next;
  // cursor além do fim (PDFs apagados desde a última chamada) recomeça do início
  const start = typeof saved === "number" && Number.isInteger(saved) && saved >= 0 && saved < docs.length ? saved : 0;
  const folders = new Map<string, string>();
  let moved = 0;
  let failed = 0;
  let i = start;
  while (i < docs.length && moved < ORGANIZE_BATCH && i - start < ORGANIZE_VISIT_LIMIT) {
    const outcome = await moveDocumentFile(mover, ws, docs[i], docs[i].topic, folders);
    i++;
    if (outcome === "moved") moved++;
    else if (outcome === "failed") failed++;
  }
  // terminou a lista: a próxima chamada recomeça do início, para pegar PDFs novos
  const next = i >= docs.length ? 0 : i;
  try {
    await state.set(organizeCursorKey(ws), { next });
  } catch (e: any) {
    // sem o cursor a próxima chamada só refaz trabalho; a organização desta chamada já foi feita
    organizeLog.warn(`Não consegui gravar o cursor de "organizar pastas": ${e?.message ?? e}`);
  }
  return { moved, failed, unchecked: docs.length - i };
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
