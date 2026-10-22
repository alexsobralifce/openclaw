import { describe, expect, it } from "vitest";
import { FILE_AVAILABLE_MS, fileExpired, fileSizeLabel, isAutoFileNote } from "../../web/src/lib/chat-file";
import { FILE_TTL_MS } from "../src/modules/channels/app-chat/app-chat.service";

describe("cartão de download do arquivo no chat", () => {
  it("o prazo da tela é o mesmo do servidor (senão o botão apareceria com o arquivo já apagado)", () => {
    expect(FILE_AVAILABLE_MS).toBe(FILE_TTL_MS);
  });
  it("expira depois de 1 hora", () => {
    const sent = "2026-10-03T17:00:00.000Z";
    expect(fileExpired(sent, Date.parse("2026-10-03T17:59:00Z"))).toBe(false);
    expect(fileExpired(sent, Date.parse("2026-10-03T18:01:00Z"))).toBe(true);
  });
  it("tamanho legível", () => {
    expect(fileSizeLabel(3_355_443)).toBe("3,2 MB");
    expect(fileSizeLabel(840_000)).toBe("820 KB");
    expect(fileSizeLabel(500)).toBe("500 B");
    expect(fileSizeLabel(undefined)).toBe("");
  });
  it("não repete o nome quando o texto é só o '📎 nome' automático", () => {
    expect(isAutoFileNote("📎 Catingueira - Marinês.mp3", "Catingueira - Marinês.mp3")).toBe(true);
    expect(isAutoFileNote("Aqui está o contrato", "contrato.pdf")).toBe(false);
    expect(isAutoFileNote("📎 x", undefined)).toBe(false);
  });
});
