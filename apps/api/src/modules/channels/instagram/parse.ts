/** Uma mensagem recebida, tirada do payload do webhook do Instagram. */
export interface InstagramEvent {
  /** Id da conta profissional que recebeu (entry.id) */
  accountId: string;
  /** Id de quem escreveu (IGSID) */
  senderId: string;
  mid: string;
  text?: string;
  attachments: { type: string; url?: string }[];
  timestamp: number;
}

/**
 * Separa as mensagens novas do payload. Ignora ecos (o que a própria conta enviou), reações,
 * confirmações de leitura e tudo que não for mensagem.
 */
export function parseInstagramWebhook(body: any): InstagramEvent[] {
  if (body?.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const out: InstagramEvent[] = [];
  for (const entry of body.entry) {
    for (const ev of entry?.messaging ?? []) {
      const m = ev?.message;
      if (!m?.mid || m.is_echo || m.is_deleted || !ev.sender?.id) continue;
      // Mensagem da própria conta (sender = conta) nunca é do cliente
      if (String(ev.sender.id) === String(entry.id)) continue;
      out.push({
        accountId: String(entry.id),
        senderId: String(ev.sender.id),
        mid: String(m.mid),
        text: typeof m.text === "string" ? m.text : undefined,
        attachments: (m.attachments ?? []).map((a: any) => ({ type: String(a?.type ?? "file"), url: a?.payload?.url })),
        timestamp: Number(ev.timestamp ?? entry.time ?? Date.now()),
      });
    }
  }
  return out;
}

const LABEL: Record<string, string> = {
  image: "📷 Imagem",
  video: "🎬 Vídeo",
  audio: "🎤 Áudio",
  file: "📎 Arquivo",
  share: "🔗 Compartilhou uma publicação",
  ig_reel: "🎬 Compartilhou um reel",
  story_mention: "📣 Mencionou você em um story",
  reel: "🎬 Reel",
};

const MEDIA_TYPE: Record<string, "IMAGE" | "VIDEO" | "AUDIO" | "FILE"> = { image: "IMAGE", video: "VIDEO", audio: "AUDIO", file: "FILE" };

/** Converte o evento para o que o inbox grava: texto, tipo e a URL da mídia (que expira, guardada só como referência). */
export function toMessageContent(ev: InstagramEvent): { body: string; type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "FILE"; metadata: Record<string, unknown> } {
  const first = ev.attachments[0];
  const type = (first && MEDIA_TYPE[first.type]) || "TEXT";
  const body = ev.text?.trim() || (first ? (LABEL[first.type] ?? "📎 Anexo") : "");
  const urls = ev.attachments.map((a) => a.url).filter(Boolean);
  return { body, type, metadata: urls.length ? { igMediaUrls: urls } : {} };
}
