import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Request, Res } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { Access } from "../../auth/access";
import { AssistantService } from "../assistant/assistant.service";
import { APP_INSTANCE, isChannelKind } from "../assistant/channel-route";
import { commanderForUser } from "../assistant/commander";
import { AppChatService } from "./app-chat.service";
import { PushService } from "./push.service";

const MAX_TEXT = 4000;

/** Chat do assistente dentro do app: histórico, envio, arquivos, notificações e escolha do canal principal. */
@Access("assistant")
@Controller("app-chat")
export class AppChatController {
  constructor(private chat: AppChatService, private push: PushService, private assistant: AssistantService) {}

  private async commander(req: any) {
    const c = await commanderForUser(req.user.id);
    if (!c) throw new ForbiddenException("Conta sem acesso ao assistente.");
    return c;
  }

  @Get("messages")
  async messages(@Request() req: any, @Query("after") after?: string, @Query("limit") limit?: string) {
    const c = await this.commander(req);
    return this.chat.list(c.userId, c.workspaceId, { after, limit: limit ? Number(limit) : undefined });
  }

  /** Mensagem do usuário: guarda, responde pelo assistente (a resposta chega pelo tempo real) e apaga o que for segredo. */
  @Post("messages")
  async send(@Request() req: any, @Body() body: { text?: string }) {
    const c = await this.commander(req);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) throw new BadRequestException("Escreva uma mensagem.");
    if (text.length > MAX_TEXT) throw new BadRequestException(`A mensagem passa de ${MAX_TEXT} caracteres.`);
    const msg = await this.chat.store(c, "IN", "TEXT", text);
    this.chat.typing(c.userId, true);
    // A resposta demora (ferramentas, IA): não prende a requisição
    void this.assistant
      .handle(c, APP_INSTANCE, text)
      .then((r) => (r?.redact ? this.chat.redact(msg.id, c) : undefined))
      .catch(() => undefined)
      .finally(() => this.chat.typing(c.userId, false));
    return msg;
  }

  @Get("files/:id")
  async file(@Request() req: any, @Param("id") id: string, @Res() res: any) {
    const f = await this.chat.file(req.user.id, id);
    if (!f) throw new NotFoundException("Arquivo não encontrado ou expirado.");
    res.set({ "Content-Type": f.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.nome)}`, "X-Content-Type-Options": "nosniff" });
    res.send(f.bytes);
  }

  @Get("push")
  async pushStatus(@Request() req: any) {
    return { enabled: this.push.enabled(), publicKey: this.push.publicKey(), subscribed: (await this.push.subscribers(req.user.id)) > 0 };
  }

  @Post("push")
  async subscribe(@Request() req: any, @Body() body: any) {
    if (!this.push.enabled()) throw new BadRequestException("Notificações não estão configuradas neste servidor.");
    try {
      await this.push.subscribe(req.user.id, body);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    return { subscribed: true };
  }

  @Delete("push")
  async unsubscribe(@Request() req: any, @Body() body: { endpoint?: string }) {
    await this.push.unsubscribe(req.user.id, String(body?.endpoint ?? ""));
    return { subscribed: false };
  }

  /** Canal preferido para o assistente falar com o usuário: whatsapp, app ou telegram. */
  @Put("channel")
  async setChannel(@Request() req: any, @Body() body: { channel?: string }) {
    if (!isChannelKind(body?.channel)) throw new BadRequestException("Canal inválido (whatsapp, app ou telegram).");
    await prisma.user.update({ where: { id: req.user.id }, data: { assistantChannel: body.channel } });
    return { channel: body.channel };
  }
}
