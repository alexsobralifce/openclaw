// Remetentes que o dono não quer que o assistente avise (lógica pura + persistência no StateService).
// Os e-mails deles continuam no Gmail, intactos: só deixam de gerar aviso e de entrar na fila/lista (ficam em "ocultos").

export interface MutePrefs {
  /** endereços em minúsculas */
  muted: string[];
  /** quantas vezes o dono apagou e-mails automáticos de cada endereço (aprendizado) */
  strikes: Record<string, number>;
}

/** Apagar duas vezes notificações automáticas do mesmo remetente basta para parar de avisar dele. */
export const STRIKES_TO_MUTE = 2;
export const MAX_MUTED = 200;
const MAX_STRIKES = 200;

export const muteKey = (ws: string) => `emailmute:${ws}`;
export const emptyMute = (): MutePrefs => ({ muted: [], strikes: {} });

/** "Fulano <fulano@x.com>" → "fulano@x.com"; vazio se não houver endereço válido. */
export function senderAddress(from = ""): string {
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(addr) ? addr : "";
}

export function isMutedSender(prefs: MutePrefs | undefined, from?: string): boolean {
  const a = senderAddress(from);
  return !!a && !!prefs?.muted.includes(a);
}

export function addMute(prefs: MutePrefs, from: string): MutePrefs {
  const a = senderAddress(from);
  if (!a) return prefs;
  const { [a]: _gone, ...strikes } = prefs.strikes;
  const muted = prefs.muted.includes(a) ? prefs.muted : [...prefs.muted, a].slice(-MAX_MUTED);
  return { muted, strikes };
}

export function removeMute(prefs: MutePrefs, from: string): MutePrefs {
  const a = senderAddress(from);
  return { muted: prefs.muted.filter((x) => x !== a), strikes: prefs.strikes };
}

/**
 * Registra que o dono descartou e-mails deste remetente.
 * `hard` (marcou como spam) silencia na hora; senão soma `count` ao contador e silencia ao chegar em STRIKES_TO_MUTE.
 */
export function recordDismiss(prefs: MutePrefs, from: string, opts: { hard?: boolean; count?: number } = {}): { prefs: MutePrefs; muted: boolean } {
  const a = senderAddress(from);
  if (!a || prefs.muted.includes(a)) return { prefs, muted: false };
  const total = (prefs.strikes[a] ?? 0) + (opts.count ?? 1);
  if (opts.hard || total >= STRIKES_TO_MUTE) return { prefs: addMute(prefs, a), muted: true };
  const strikes = { ...prefs.strikes, [a]: total };
  const keys = Object.keys(strikes);
  if (keys.length > MAX_STRIKES) delete strikes[keys[0]];
  return { prefs: { ...prefs, strikes }, muted: false };
}

interface Store {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}

export async function loadMute(state: Store, ws: string): Promise<MutePrefs> {
  const v = await state.get<MutePrefs>(muteKey(ws));
  return { muted: Array.isArray(v?.muted) ? v!.muted : [], strikes: v?.strikes && typeof v.strikes === "object" ? v.strikes : {} };
}

export const saveMute = (state: Store, ws: string, prefs: MutePrefs) => state.set(muteKey(ws), prefs);
