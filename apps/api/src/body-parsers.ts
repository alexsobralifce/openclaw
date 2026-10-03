import { json } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

/** Rota do webhook do WhatsApp: chega com arquivo (PDF, foto) e passa de 100 KB. */
export const WHATSAPP_WEBHOOK_PATH = "/api/v1/channels/webhooks/whatsapp";

// O Instagram assina o corpo cru do webhook, então os dois leitores de JSON guardam `req.rawBody` (o que `rawBody: true` do Nest faz).
const keepRaw = (req: any, _res: unknown, buf: Buffer) => {
  req.rawBody = buf;
};

/**
 * Leitores de JSON da API: 25 MB só na rota do WhatsApp, o padrão (100 KB) no resto.
 * Registrar o primeiro com `app.use(json())` faz o Nest achar que já existe um leitor global e NÃO instalar o dele:
 * sem o segundo `app.use`, nenhuma outra rota lê JSON (o login e todo POST chegam com o corpo vazio).
 * Use com `NestFactory.create(..., { bodyParser: true })` (padrão); o leitor de formulário continua sendo o do Nest.
 */
export function configureBodyParsers(app: NestExpressApplication) {
  app.use(WHATSAPP_WEBHOOK_PATH, json({ limit: "25mb", verify: keepRaw }));
  app.use(json({ verify: keepRaw }));
}
