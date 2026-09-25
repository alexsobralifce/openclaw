// Fila de e-mails novos a tratar (lógica pura; a persistência fica no MenuService).

export interface QueuedEmail {
  account: string;
  id: string;
  de: string;
  assunto: string;
  /** Momento de chegada (internalDate do Gmail, em ms) */
  at: number;
}

export const QUEUE_MAX = 50;
export const QUEUE_TTL_MS = 48 * 3600_000;

/** Junta os novos e-mails à fila: sem repetir (conta + id), do mais antigo para o mais novo, com teto de tamanho. */
export function mergeQueue(current: QueuedEmail[], incoming: QueuedEmail[]): QueuedEmail[] {
  const seen = new Set<string>();
  const out: QueuedEmail[] = [];
  for (const m of [...current, ...incoming]) {
    const k = `${m.account}:${m.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  // Se estourar o teto, descarta os mais antigos (continuam não lidos no Gmail)
  return out.length > QUEUE_MAX ? out.slice(out.length - QUEUE_MAX) : out;
}

export function removeFromQueue(queue: QueuedEmail[], id: string, account?: string): QueuedEmail[] {
  return queue.filter((m) => !(m.id === id && (!account || m.account === account)));
}

/** "14:32" para hoje, "23/09 14:32" para outros dias, no fuso informado. */
export function fmtWhen(at: number | undefined, timeZone: string, now = Date.now()): string {
  if (!at || !Number.isFinite(at)) return "";
  const d = new Date(at);
  const day = (x: Date) => x.toLocaleDateString("sv-SE", { timeZone });
  const time = d.toLocaleTimeString("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(new Date(now))) return time;
  const [, mm, dd] = day(d).split("-");
  return `${dd}/${mm} ${time}`;
}
