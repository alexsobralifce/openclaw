import { describe, expect, it } from "vitest";
import { commandText, isVoiceOrAudio, parseWhatsappMessage } from "../src/modules/channels/whatsapp/parse";

describe("parseWhatsappMessage", () => {
  it("texto simples e texto estendido (respostas, links)", () => {
    expect(parseWhatsappMessage({ conversation: "oi" })).toEqual({ type: "TEXT", body: "oi" });
    expect(parseWhatsappMessage({ extendedTextMessage: { text: "veja https://x.com" } })).toEqual({ type: "TEXT", body: "veja https://x.com" });
  });

  it("mídias com e sem legenda", () => {
    expect(parseWhatsappMessage({ imageMessage: { caption: "foto", mimetype: "image/jpeg" } })).toMatchObject({ type: "IMAGE", body: "foto", metadata: { mimetype: "image/jpeg" } });
    expect(parseWhatsappMessage({ imageMessage: {} })?.body).toBe("[imagem]");
    expect(parseWhatsappMessage({ videoMessage: { seconds: 3 } })).toMatchObject({ type: "VIDEO", body: "[vídeo]" });
    expect(parseWhatsappMessage({ audioMessage: { ptt: true } })).toMatchObject({ type: "AUDIO", body: "[mensagem de voz]", metadata: { ptt: true } });
    expect(parseWhatsappMessage({ stickerMessage: {} })).toMatchObject({ type: "IMAGE", body: "[figurinha]" });
  });

  it("documento, inclusive com legenda embrulhada", () => {
    expect(parseWhatsappMessage({ documentMessage: { fileName: "nota.pdf" } })).toMatchObject({ type: "FILE", body: "[documento: nota.pdf]", metadata: { fileName: "nota.pdf" } });
    const wrapped = { documentWithCaptionMessage: { message: { documentMessage: { fileName: "a.pdf", caption: "segue" } } } };
    expect(parseWhatsappMessage(wrapped)).toMatchObject({ type: "FILE", body: "segue" });
  });

  it("desembrulha mensagens temporárias e de visualização única", () => {
    expect(parseWhatsappMessage({ ephemeralMessage: { message: { conversation: "sumirá" } } })?.body).toBe("sumirá");
    expect(parseWhatsappMessage({ viewOnceMessageV2: { message: { imageMessage: { caption: "x" } } } })?.type).toBe("IMAGE");
  });

  it("localização e contato viram texto legível", () => {
    const loc = parseWhatsappMessage({ locationMessage: { degreesLatitude: -3.7, degreesLongitude: -38.5, name: "Loja" } });
    expect(loc?.body).toContain("Loja");
    expect(loc?.body).toContain("maps.google.com/?q=-3.7,-38.5");
    expect(parseWhatsappMessage({ contactMessage: { displayName: "Ana" } })?.body).toBe("👤 Contato: Ana");
  });

  it("ignora reações, mensagens apagadas e metadados", () => {
    expect(parseWhatsappMessage({ reactionMessage: { text: "👍" } })).toBeNull();
    expect(parseWhatsappMessage({ protocolMessage: { type: 0 }, messageContextInfo: {} })).toBeNull();
    expect(parseWhatsappMessage(undefined)).toBeNull();
  });

  it("tipos desconhecidos não viram áudio vazio", () => {
    expect(parseWhatsappMessage({ algoNovoMessage: {} })).toEqual({ type: "TEXT", body: "[mensagem não suportada]", metadata: { unsupported: "algoNovoMessage" } });
  });

  it("comando do assistente", () => {
    expect(commandText({ extendedTextMessage: { text: "menu" } })).toBe("menu");
    expect(commandText({ imageMessage: { caption: "x" } })).toBe("");
    expect(isVoiceOrAudio({ ephemeralMessage: { message: { audioMessage: {} } } })).toBe(true);
  });
});

import { agendaMedia, quotedText } from "../src/modules/channels/whatsapp/parse";

describe("mídia e citação para a agenda", () => {
  it("imagem e PDF são reconhecidos, com a legenda; áudio e texto não", () => {
    expect(agendaMedia({ imageMessage: { mimetype: "image/png", caption: "adicione na agenda" } })).toEqual({ mime: "image/png", caption: "adicione na agenda" });
    expect(agendaMedia({ documentMessage: { mimetype: "application/pdf" } })).toEqual({ mime: "application/pdf", caption: "" });
    expect(agendaMedia({ documentMessage: { mimetype: "application/zip" } })).toBeNull();
    expect(agendaMedia({ audioMessage: {} })).toBeNull();
    expect(agendaMedia({ conversation: "oi" })).toBeNull();
  });

  it("lê o texto da mensagem citada, inclusive legenda de imagem", () => {
    const q = (quotedMessage: any) => ({ extendedTextMessage: { text: "põe na agenda", contextInfo: { quotedMessage } } });
    expect(quotedText(q({ conversation: "Reunião dia 5 às 10h" }))).toBe("Reunião dia 5 às 10h");
    expect(quotedText(q({ imageMessage: { caption: "Festa dia 12" } }))).toBe("Festa dia 12");
    expect(quotedText({ conversation: "sem citação" })).toBe("");
  });
});
