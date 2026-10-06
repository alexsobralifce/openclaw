import { describe, expect, it } from "vitest";
import { channelOrder, pickChannel } from "../src/modules/channels/assistant/channel-route";

describe("canal padrão do assistente: o app", () => {
  it("sem preferência, o app vem primeiro; o WhatsApp só entra para quem o escolher", () => {
    expect(channelOrder(null)).toEqual(["app", "whatsapp", "telegram"]);
    expect(channelOrder(undefined)).toEqual(["app", "whatsapp", "telegram"]);
    expect(channelOrder("whatsapp")).toEqual(["whatsapp", "app", "telegram"]);
    expect(channelOrder("telegram")).toEqual(["telegram", "app", "whatsapp"]);
  });

  it("avisos vão para o app mesmo com WhatsApp e Telegram disponíveis, se ninguém escolheu outro canal", () => {
    expect(pickChannel(null, { whatsapp: true, app: true, telegram: true })).toBe("app");
    expect(pickChannel("whatsapp", { whatsapp: true, app: true, telegram: true })).toBe("whatsapp");
    expect(pickChannel("whatsapp", { whatsapp: false, app: true, telegram: true })).toBe("app");
  });
});
