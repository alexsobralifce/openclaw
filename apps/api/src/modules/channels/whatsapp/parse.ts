export type ParsedType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "FILE";

export interface ParsedMessage {
  type: ParsedType;
  body: string;
  metadata?: Record<string, unknown>;
}

// Envelopes que só embrulham a mensagem real
const WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage"];
// Eventos que não são conteúdo para o inbox
const IGNORED = ["protocolMessage", "reactionMessage", "senderKeyDistributionMessage", "pollUpdateMessage", "keepInChatMessage", "pinInChatMessage"];

function unwrap(message: any): any {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const w = WRAPPERS.find((k) => m[k]?.message);
    if (!w) break;
    m = m[w].message;
  }
  return m;
}

const media = (m: any) => ({
  ...(m.mimetype ? { mimetype: m.mimetype } : {}),
  ...(m.fileLength ? { size: Number(m.fileLength) || undefined } : {}),
  ...(m.seconds ? { seconds: m.seconds } : {}),
});

/** Converte a mensagem do Evolution (Baileys) no formato do inbox; nulo quando não é conteúdo (reações, apagadas...). */
export function parseWhatsappMessage(message: any): ParsedMessage | null {
  const m = unwrap(message);
  if (!m || typeof m !== "object") return null;

  if (typeof m.conversation === "string") return { type: "TEXT", body: m.conversation };
  if (m.extendedTextMessage) return { type: "TEXT", body: m.extendedTextMessage.text ?? "" };

  if (m.imageMessage) return { type: "IMAGE", body: m.imageMessage.caption || "[imagem]", metadata: media(m.imageMessage) };
  if (m.stickerMessage) return { type: "IMAGE", body: "[figurinha]", metadata: { ...media(m.stickerMessage), sticker: true } };
  if (m.videoMessage || m.ptvMessage) {
    const v = m.videoMessage ?? m.ptvMessage;
    return { type: "VIDEO", body: v.caption || "[vídeo]", metadata: media(v) };
  }
  if (m.audioMessage) {
    return { type: "AUDIO", body: m.audioMessage.ptt ? "[mensagem de voz]" : "[áudio]", metadata: { ...media(m.audioMessage), ptt: !!m.audioMessage.ptt } };
  }
  if (m.documentMessage) {
    const d = m.documentMessage;
    const name = d.fileName || d.title || "arquivo";
    return { type: "FILE", body: d.caption || `[documento: ${name}]`, metadata: { ...media(d), fileName: name } };
  }

  if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage ?? m.liveLocationMessage;
    const lat = l.degreesLatitude;
    const lng = l.degreesLongitude;
    const label = [l.name, l.address].filter(Boolean).join(" - ");
    return {
      type: "TEXT",
      body: `📍 ${label || "Localização"}${lat != null && lng != null ? ` https://maps.google.com/?q=${lat},${lng}` : ""}`,
      metadata: { kind: "location", lat, lng, live: !!m.liveLocationMessage },
    };
  }
  if (m.contactMessage) {
    return { type: "TEXT", body: `👤 Contato: ${m.contactMessage.displayName ?? ""}`.trim(), metadata: { kind: "contact", vcard: m.contactMessage.vcard } };
  }
  if (m.contactsArrayMessage) {
    const names = (m.contactsArrayMessage.contacts ?? []).map((c: any) => c.displayName).filter(Boolean);
    return { type: "TEXT", body: `👤 Contatos: ${names.join(", ")}`, metadata: { kind: "contacts" } };
  }

  // Respostas a botões, listas e enquetes
  if (m.buttonsResponseMessage) return { type: "TEXT", body: m.buttonsResponseMessage.selectedDisplayText ?? m.buttonsResponseMessage.selectedButtonId ?? "" };
  if (m.templateButtonReplyMessage) return { type: "TEXT", body: m.templateButtonReplyMessage.selectedDisplayText ?? "" };
  if (m.listResponseMessage) return { type: "TEXT", body: m.listResponseMessage.title ?? m.listResponseMessage.singleSelectReply?.selectedRowId ?? "" };
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (poll) return { type: "TEXT", body: `📊 Enquete: ${poll.name ?? ""}`, metadata: { kind: "poll", options: (poll.options ?? []).map((o: any) => o.optionName) } };

  const kinds = Object.keys(m).filter((k) => k !== "messageContextInfo");
  if (!kinds.length || kinds.every((k) => IGNORED.includes(k))) return null;
  return { type: "TEXT", body: "[mensagem não suportada]", metadata: { unsupported: kinds[0] } };
}

/** Texto que o assistente deve interpretar como comando (texto digitado ou ditado). */
export function commandText(message: any): string {
  const m = unwrap(message);
  return m?.conversation || m?.extendedTextMessage?.text || "";
}

export function isVoiceOrAudio(message: any): boolean {
  return !!unwrap(message)?.audioMessage;
}

/** Duração do áudio em segundos, quando o WhatsApp informa; nulo para qualquer outra mensagem. */
export function audioSeconds(message: any): number | null {
  const n = Number(unwrap(message)?.audioMessage?.seconds);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Imagem ou PDF enviado ao assistente (para ler compromissos), com a legenda; nulo para qualquer outra mensagem. */
export function agendaMedia(message: any): { mime: string; caption: string } | null {
  const m = unwrap(message);
  if (m?.imageMessage) return { mime: m.imageMessage.mimetype || "image/jpeg", caption: m.imageMessage.caption ?? "" };
  const d = m?.documentMessage;
  if (d && /pdf/i.test(d.mimetype ?? "")) return { mime: "application/pdf", caption: d.caption ?? "" };
  return null;
}

/** Localização compartilhada (pin do WhatsApp); nula para qualquer outra mensagem. */
export function locationOf(message: any): { lat: number; lng: number; name: string } | null {
  const m = unwrap(message);
  const l = m?.locationMessage ?? m?.liveLocationMessage;
  if (!l || typeof l.degreesLatitude !== "number" || typeof l.degreesLongitude !== "number") return null;
  return { lat: l.degreesLatitude, lng: l.degreesLongitude, name: [l.name, l.address].filter(Boolean).join(" - ") };
}

/** Texto da mensagem que o usuário respondeu/citou ("adicione isso na agenda" respondendo a um post); vazio se não houver. */
export function quotedText(message: any): string {
  const q = unwrap(message)?.extendedTextMessage?.contextInfo?.quotedMessage;
  const inner = unwrap(q);
  return String(inner?.conversation || inner?.extendedTextMessage?.text || inner?.imageMessage?.caption || inner?.videoMessage?.caption || "").slice(0, 4000);
}
