import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Logger, Post, Request } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { randomBytes, timingSafeEqual } from "crypto";
import { Access } from "../../auth/access";
import { StateService } from "../../state/state.service";
import { AssistantService } from "../assistant/assistant.service";
import { commanderForTelegram } from "../assistant/commander";
import { TELEGRAM_INSTANCE } from "../assistant/channel-route";
import { newLinkCode, startCode } from "./telegram-format";
import { TelegramService } from "./telegram.service";

const LINK_TTL_MS = 10 * 60_000;
const linkKey = (code: string) => `tg:link:${code}`;

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Controller("channels/telegram")
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private telegram: TelegramService, private assistant: AssistantService, private state: StateService) {}

  /** Mensagens que o Telegram entrega ao bot. Pública, mas só aceita quem manda o segredo combinado no setWebhook. */
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Headers("x-telegram-bot-api-secret-token") secret: string | undefined, @Body() update: any) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!this.telegram.enabled() || !expected || !secret || !sameSecret(secret, expected)) throw new ForbiddenException();
    // Responde 200 logo: o Telegram reenvia o que demora; o tratamento segue em segundo plano
    void this.handleUpdate(update).catch((e) => this.logger.error(`Telegram: falha ao tratar a mensagem: ${e.message}`));
    return { ok: true };
  }

  private async handleUpdate(update: any) {
    const msg = update?.message;
    const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
    // Só conversa privada: um grupo nunca é um usuário vinculado
    if (!msg || !chatId || msg.chat.type !== "private") return;
    const text: string = typeof msg.text === "string" ? msg.text.trim() : "";

    const code = startCode(text);
    if (code) return this.link(chatId, code);

    const c = await commanderForTelegram(chatId);
    if (!c) return this.telegram.sendText(chatId, "Este chat ainda não está vinculado. No app MagoBox, abra as configurações do assistente, gere o código do Telegram e envie /start CÓDIGO aqui.");
    if (!text) return this.telegram.sendText(chatId, "Por enquanto, pelo Telegram, só entendo mensagens de texto.");
    await this.assistant.handle(c, TELEGRAM_INSTANCE, text);
  }

  private async link(chatId: string, code: string) {
    const pending = await this.state.get<{ userId: string }>(linkKey(code));
    if (!pending) return this.telegram.sendText(chatId, "Código inválido ou vencido. Gere um novo no app.");
    // Um chat só pode pertencer a um usuário (sem @unique no banco, a unicidade fica aqui)
    const other = await prisma.user.findFirst({ where: { telegramChatId: chatId, id: { not: pending.userId } }, select: { id: true } });
    if (other) return this.telegram.sendText(chatId, "Este Telegram já está vinculado a outra conta.");
    await prisma.user.update({ where: { id: pending.userId }, data: { telegramChatId: chatId } });
    await this.state.del(linkKey(code));
    await this.telegram.sendText(chatId, "✅ Telegram vinculado ao MagoBox. Pode me mandar seus pedidos por aqui. O cofre de senhas continua só no app e no WhatsApp.");
  }

  /** Gera o código que o usuário envia ao bot (/start CÓDIGO) para vincular o chat dele. */
  @Access("assistant")
  @Post("link")
  async createLink(@Request() req: any) {
    if (!this.telegram.enabled()) throw new BadRequestException("O Telegram não está configurado neste servidor.");
    const code = newLinkCode((n) => randomBytes(n));
    await this.state.set(linkKey(code), { userId: req.user.id }, LINK_TTL_MS);
    const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "";
    return { code, expiresInSeconds: LINK_TTL_MS / 1000, bot, url: bot ? `https://t.me/${bot}?start=${code}` : null };
  }

  @Access("assistant")
  @Get("status")
  async status(@Request() req: any) {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { telegramChatId: true } });
    return { configured: this.telegram.enabled(), linked: !!u?.telegramChatId };
  }

  @Access("assistant")
  @Delete("link")
  async unlink(@Request() req: any) {
    await prisma.user.update({ where: { id: req.user.id }, data: { telegramChatId: null } });
    return { linked: false };
  }
}
