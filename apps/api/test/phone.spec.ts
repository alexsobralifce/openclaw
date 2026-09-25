import { describe, expect, it } from "vitest";
import { isGroupOrBroadcast, phoneFromJid, phoneVariants, samePhone, senderPhone } from "../src/modules/channels/whatsapp/phone";

describe("telefones do WhatsApp", () => {
  it("considera o nono dígito dos celulares brasileiros", () => {
    expect(phoneVariants("5588992215701").sort()).toEqual(["558892215701", "5588992215701"]);
    expect(phoneVariants("558892215701").sort()).toEqual(["558892215701", "5588992215701"]);
    expect(samePhone("558892215701", "+55 (88) 99221-5701")).toBe(true);
    expect(samePhone("5588992215701", "5588992215702")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });

  it("não inventa variantes para números estrangeiros", () => {
    expect(phoneVariants("14155550100")).toEqual(["14155550100"]);
  });

  it("extrai o número do JID pessoal e ignora LIDs", () => {
    expect(phoneFromJid("5588992215701@s.whatsapp.net")).toBe("5588992215701");
    expect(phoneFromJid("123456789@lid")).toBeNull();
  });

  it("usa remoteJidAlt/senderPn quando a conversa vem por LID", () => {
    expect(senderPhone({ remoteJid: "999@lid", remoteJidAlt: "5585911112222@s.whatsapp.net" })).toBe("5585911112222");
    expect(senderPhone({ remoteJid: "999@lid", senderPn: "5585911112222@s.whatsapp.net" })).toBe("5585911112222");
    expect(senderPhone({ remoteJid: "999@lid" })).toBeNull();
  });

  it("reconhece grupos, status e canais", () => {
    expect(isGroupOrBroadcast("123@g.us")).toBe(true);
    expect(isGroupOrBroadcast("status@broadcast")).toBe(true);
    expect(isGroupOrBroadcast("1@newsletter")).toBe(true);
    expect(isGroupOrBroadcast("5585@s.whatsapp.net")).toBe(false);
  });
});
