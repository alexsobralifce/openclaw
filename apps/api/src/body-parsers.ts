import { json } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

/** Rota do webhook do WhatsApp: chega com arquivo (PDF, foto) e passa de 100 KB. */
export const WHATSAPP_WEBHOOK_PATH = "/api/v1/channels/webhooks/whatsapp";

/** Rotas que recebem arquivo em base64: o webhook do WhatsApp e o áudio e o arquivo do chat do app (o limite de 15 MB do arquivo é conferido na rota). */
export const BIG_BODY_PATHS = [WHATSAPP_WEBHOOK_PATH, "/api/v1/app-chat/audio", "/api/v1/app-chat/file"];

/**
 * Leitores de JSON da API: 25 MB só nas rotas de arquivo (`BIG_BODY_PATHS`), o padrão (100 KB) no resto.
 * Registrar o primeiro com `app.use(json())` faz o Nest achar que já existe um leitor global e NÃO instalar o dele:
 * sem o segundo `app.use`, nenhuma outra rota lê JSON (o login e todo POST chegam com o corpo vazio).
 * Use com `NestFactory.create(..., { bodyParser: true })` (padrão); o leitor de formulário continua sendo o do Nest.
 */
export function configureBodyParsers(app: NestExpressApplication) {
  for (const path of BIG_BODY_PATHS) app.use(path, json({ limit: "25mb" }));
  app.use(json());
}
