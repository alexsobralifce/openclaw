import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { splitForTelegram, waToTelegramHtml } from "./telegram-format";

/** Envio de mensagens e arquivos pelo bot do Telegram. Só funciona com TELEGRAM_BOT_TOKEN configurado. */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  /** Aponta o bot para este servidor (precisa de API_URL e TELEGRAM_WEBHOOK_SECRET). Falha só vira aviso no log. */
  async onModuleInit() {
    if (!this.enabled() || !process.env.API_URL || !process.env.TELEGRAM_WEBHOOK_SECRET) return;
    try {
      await this.call("setWebhook", JSON.stringify({ url: `${process.env.API_URL}/api/v1/channels/telegram/webhook`, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"] }));
    } catch (e: any) {
      this.logger.warn(`Telegram: não consegui registrar o webhook: ${e.message}`);
    }
  }

  enabled() {
    return !!process.env.TELEGRAM_BOT_TOKEN;
  }

  private async call(method: string, body: string | FormData, json = true) {
    if (!this.enabled()) throw new Error("Telegram não configurado");
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      this.logger.warn(`Telegram ${method} falhou: ${res.status} ${data.description ?? ""}`);
      throw new Error(data.description ?? `Telegram ${method} falhou (${res.status})`);
    }
    return data.result;
  }

  /** Texto do assistente (marcação do WhatsApp) em uma ou mais mensagens. */
  async sendText(chatId: string, text: string) {
    for (const part of splitForTelegram(text)) {
      await this.call("sendMessage", JSON.stringify({ chat_id: chatId, text: waToTelegramHtml(part), parse_mode: "HTML", disable_web_page_preview: true }));
    }
  }

  async sendDocument(chatId: string, base64: string, fileName: string, mime: string, caption?: string) {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) {
      form.append("caption", waToTelegramHtml(caption).slice(0, 1000));
      form.append("parse_mode", "HTML");
    }
    form.append("document", new Blob([Buffer.from(base64, "base64")], { type: mime }), fileName);
    await this.call("sendDocument", form, false);
  }
}
