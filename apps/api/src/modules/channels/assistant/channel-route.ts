/** Canais pelos quais o assistente fala com o usuário: WhatsApp, app (chat embutido) ou Telegram. */
export type ChannelKind = "whatsapp" | "app" | "telegram";

export const CHANNELS: ChannelKind[] = ["whatsapp", "app", "telegram"];
export const APP_INSTANCE = "app";
export const TELEGRAM_INSTANCE = "telegram";

export const isChannelKind = (v: unknown): v is ChannelKind => typeof v === "string" && (CHANNELS as string[]).includes(v);

export const channelOfInstance = (instance: string): ChannelKind => (instance === APP_INSTANCE ? "app" : instance === TELEGRAM_INSTANCE ? "telegram" : "whatsapp");

/** Ordem de preferência de canal, começando pelo preferido (ou "app" se não houver um válido). */
export function channelOrder(preferred?: string | null): ChannelKind[] {
  const first: ChannelKind = isChannelKind(preferred) ? preferred : "app";
  return [first, ...(["app", "whatsapp", "telegram"] as ChannelKind[]).filter((c) => c !== first)];
}

/** Escolhe o primeiro canal disponível na ordem de preferência. */
export function pickChannel(preferred: string | null | undefined, available: Record<ChannelKind, boolean>): ChannelKind | null {
  return channelOrder(preferred).find((c) => available[c]) ?? null;
}

export const connKey = (instance: string) => `wa:conn:${instance}`;

export const isWhatsappDown = (c: { state?: string } | null | undefined) => !!c && c.state === "close";
