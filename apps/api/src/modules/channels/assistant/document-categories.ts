// Categorias dos documentos: as dos próprios documentos (campo `topic`) mais as criadas à mão, que podem estar vazias.
// As criadas à mão ficam no estado (não há tabela de categorias). Usado pelo assistente e pelo painel, para os dois seguirem a mesma regra.

import { categoriesStateKey, categoryKey, Category, cleanCategory, docsInCategory, MAX_CUSTOM_CATEGORIES, mergeCategories, NO_CATEGORY, topCategories } from "./documents";
import { listDocuments, setDocumentsTopic } from "./documents-store";

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

export type DeleteCategoryResult = { ok: true; name: string; moved: number } | { ok: false; reason: "fixed" | "notfound" };

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
  return { ok: true, name, moved };
}
