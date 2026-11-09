// Cache em memória do grafo de documentos, por workspace. Sem I/O próprio: quem busca os documentos e a
// impressão digital (contagem + último updatedAt) é injetado. Cada réplica tem o seu cache; a impressão digital
// garante que uma escrita feita em outra réplica também reconstrói o grafo antes de ser usado.

import { buildDocGraph, DocGraph } from "./document-graph";
import type { DocLike } from "./documents";

export interface DocIndexOptions<T extends DocLike> {
  fetchDocs: (workspaceId: string) => Promise<T[]>;
  fingerprint: (workspaceId: string) => Promise<string>;
  maxWorkspaces?: number;
  ttlMs?: number;
  now?: () => number;
}

interface Entry {
  graph: DocGraph;
  fingerprint: string;
  loadedAt: number;
}

const MAX_WORKSPACES = 50;
const TTL_MS = 10 * 60_000;

export class DocIndex<T extends DocLike> {
  private readonly cache = new Map<string, Entry>();
  private readonly maxWorkspaces: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: DocIndexOptions<T>) {
    this.maxWorkspaces = opts.maxWorkspaces ?? MAX_WORKSPACES;
    this.ttlMs = opts.ttlMs ?? TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Grafo do workspace: do cache se a impressão digital e o TTL estiverem ok; senão, reconstrói. */
  async get(workspaceId: string): Promise<DocGraph> {
    const hit = this.cache.get(workspaceId);
    if (hit && this.now() - hit.loadedAt < this.ttlMs && (await this.opts.fingerprint(workspaceId)) === hit.fingerprint) {
      this.touch(workspaceId, hit);
      return hit.graph;
    }
    // A impressão digital é lida antes dos documentos: se algo mudar no meio, a próxima leitura percebe.
    const fingerprint = await this.opts.fingerprint(workspaceId);
    const docs = await this.opts.fetchDocs(workspaceId);
    const entry: Entry = { graph: buildDocGraph(docs), fingerprint, loadedAt: this.now() };
    this.cache.delete(workspaceId);
    this.touch(workspaceId, entry);
    return entry.graph;
  }

  /** Chamado pelas escritas locais: o próximo get reconstrói. */
  invalidate(workspaceId: string): void {
    this.cache.delete(workspaceId);
  }

  private touch(workspaceId: string, entry: Entry): void {
    this.cache.delete(workspaceId);
    this.cache.set(workspaceId, entry);
    while (this.cache.size > this.maxWorkspaces) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
