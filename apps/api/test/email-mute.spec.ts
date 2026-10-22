import { describe, expect, it } from "vitest";
import { addMute, emptyMute, isMutedSender, recordDismiss, removeMute, senderAddress } from "../src/modules/channels/assistant/email-mute";
import { classifyEmail, isHidden } from "../src/modules/channels/assistant/email-filter";

describe("remetentes sem interesse", () => {
  it("extrai o endereço em minúsculas e recusa lixo", () => {
    expect(senderAddress("Fulano <Fulano@Empresa.com>")).toBe("fulano@empresa.com");
    expect(senderAddress("a@b.com")).toBe("a@b.com");
    expect(senderAddress("sem endereço")).toBe("");
    expect(senderAddress(undefined)).toBe("");
  });

  it("marcar e desmarcar", () => {
    let p = addMute(emptyMute(), "Loja <Ofertas@Loja.com>");
    expect(isMutedSender(p, "ofertas@loja.com")).toBe(true);
    expect(isMutedSender(p, "outro@loja.com")).toBe(false);
    p = removeMute(p, "ofertas@loja.com");
    expect(isMutedSender(p, "ofertas@loja.com")).toBe(false);
  });

  it("aprende: apagar 2 automáticos silencia; a 1ª vez só conta", () => {
    const a = recordDismiss(emptyMute(), "GitHub <noreply@github.com>");
    expect(a.muted).toBe(false);
    expect(a.prefs.strikes["noreply@github.com"]).toBe(1);
    const b = recordDismiss(a.prefs, "noreply@github.com");
    expect(b.muted).toBe(true);
    expect(isMutedSender(b.prefs, "noreply@github.com")).toBe(true);
    expect(b.prefs.strikes["noreply@github.com"]).toBeUndefined();
  });

  it("apagar vários do mesmo remetente de uma vez, ou marcar spam, silencia na hora", () => {
    expect(recordDismiss(emptyMute(), "x@y.com", { count: 3 }).muted).toBe(true);
    expect(recordDismiss(emptyMute(), "x@y.com", { hard: true }).muted).toBe(true);
  });

  it("o filtro trata o silenciado como oculto", () => {
    const prefs = addMute(emptyMute(), "maria@empresa.com");
    const c = classifyEmail({ de: "Maria <maria@empresa.com>", assunto: "Reunião" }, prefs);
    expect(c.kind).toBe("muted");
    expect(isHidden(c.kind)).toBe(true);
    expect(classifyEmail({ de: "Maria <maria@empresa.com>", assunto: "Reunião" }).kind).toBe("person");
  });
});
