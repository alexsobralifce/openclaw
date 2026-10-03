import "reflect-metadata";
import { Body, Controller, Post, Req, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { configureBodyParsers, WHATSAPP_WEBHOOK_PATH } from "../src/body-parsers";

@Controller("x")
class EchoController {
  @Post() echo(@Body("a") a: unknown, @Req() req: any) {
    return { a, raw: req.rawBody?.toString() ?? null };
  }
  @Post("form") form(@Body("a") a: unknown) {
    return { a };
  }
}
@Controller("channels/webhooks/whatsapp")
class WhatsappController {
  @Post("inst") hook(@Body("big") big: string) {
    return { size: big.length };
  }
}

async function start() {
  const mod = await Test.createTestingModule({ controllers: [EchoController, WhatsappController] }).compile();
  const app = mod.createNestApplication({ rawBody: true });
  configureBodyParsers(app as any);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = `${(await app.getUrl()).replace("[::1]", "localhost")}/api/v1`;
  return { app, base };
}
const post = (url: string, body: string, type = "application/json") => fetch(url, { method: "POST", headers: { "Content-Type": type }, body });

describe("leitores de corpo da API", () => {
  it("lê JSON nas rotas comuns e guarda o corpo cru (assinatura do Instagram)", async () => {
    const { app, base } = await start();
    const r = await (await post(`${base}/x`, JSON.stringify({ a: 1 }))).json();
    expect(r).toEqual({ a: 1, raw: '{"a":1}' });
    await app.close();
  });

  it("continua lendo formulário", async () => {
    const { app, base } = await start();
    expect(await (await post(`${base}/x/form`, "a=oi", "application/x-www-form-urlencoded")).json()).toEqual({ a: "oi" });
    await app.close();
  });

  it("aceita corpo grande só no webhook do WhatsApp", async () => {
    const { app, base } = await start();
    const big = JSON.stringify({ big: "x".repeat(300_000), a: 1 });
    expect((await post(`${base}/channels/webhooks/whatsapp/inst`, big)).status).toBe(201);
    expect((await post(`${base}/x`, big)).status).toBe(413);
    await app.close();
    expect(WHATSAPP_WEBHOOK_PATH).toBe("/api/v1/channels/webhooks/whatsapp");
  });

  it("JSON inválido dá 400", async () => {
    const { app, base } = await start();
    expect((await post(`${base}/x`, "{bad")).status).toBe(400);
    await app.close();
  });
});
