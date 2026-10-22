// Canais do assistente (WhatsApp, app e Telegram): qual usar para falar com o usuário (lógica pura).
// Uma "instância" identifica o destino de uma resposta: o nome da instância da Evolution (WhatsApp), "app" ou "telegram".

export type ChannelKind = "whatsapp" | "app" | "telegram";
export const CHANNELS: ChannelKind[] = ["whatsapp", "app", "telegram"];
export const APP_INSTANCE = "app";
export const TELEGRAM_INSTANCE = "telegram";

export const isChannelKind = (v: unknown): v is ChannelKind => typeof v === "string" && (CHANNELS as string[]).includes(v);
export const channelOfInstance = (instance: string): ChannelKind => (instance === APP_INSTANCE ? "app" : instance === TELEGRAM_INSTANCE ? "telegram" : "whatsapp");

/** Ordem de tentativa: o canal preferido primeiro, depois os outros (o app antes do Telegram, por estar sempre disponível). */
export function channelOrder(preferred: ChannelKind | null | undefined): ChannelKind[] {
  const first: ChannelKind = isChannelKind(preferred) ? preferred : "app";
  return [first, ...(["app", "whatsapp", "telegram"] as ChannelKind[]).filter((c) => c !== first)];
}

/** Primeiro canal disponível pela ordem de preferência; null se nenhum. */
export function pickChannel(preferred: ChannelKind | null | undefined, available: Record<ChannelKind, boolean>): ChannelKind | null {
  return channelOrder(preferred).find((c) => available[c]) ?? null;
}

/** Estado de conexão guardado para uma instância do WhatsApp (vem do evento connection.update da Evolution). */
export const connKey = (instance: string) => `wa:conn:${instance}`;
export interface ConnState {
  state: string;
  at: number;
}
/** O WhatsApp está fora? Só vale "close"; sem registro ou "open"/"connecting" conta como no ar (não troca de canal por dúvida). */
export const isWhatsappDown = (c: ConnState | null | undefined) => !!c && c.state === "close";
