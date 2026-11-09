import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Request, Res } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { Access } from "../../auth/access";
import { AssistantService, MAX_MEDIA_BYTES } from "../assistant/assistant.service";
import { APP_INSTANCE, isChannelKind } from "../assistant/channel-route";
import { commanderForUser } from "../assistant/commander";
import { GoogleService } from "../../integrations/google/google.service";
import { AppChatService } from "./app-chat.service";
import { PushService } from "./push.service";
import { StateService } from "../../state/state.service";

const MAX_TEXT = 4000;
/** Ao abrir o app, o menu só é mostrado de novo se a conversa está parada há mais que isso (boas-vindas e menu). */
const OPEN_MENU_AFTER_MS = 3 * 60_000;
const FILE_MIMES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;

const bytesOf = (base64: unknown) => (typeof base64 === "string" ? Math.floor(base64.length * 0.75) : 0);

/** Chat do assistente dentro do app: histórico, envio, arquivos, notificações e escolha do canal principal. */
@Access("assistant")
@Controller("app-chat")
export class AppChatController {
  constructor(private chat: AppChatService, private push: PushService, private assistant: AssistantService, private google: GoogleService, private state: StateService) {}

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

  /** O app abriu: se a conversa está vazia ou parada, entrega o menu principal na hora (chega pelo tempo real). */
  @Post("open")
  async open(@Request() req: any) {
    const c = await this.commander(req);
    const last = (await this.chat.list(c.userId, c.workspaceId, { limit: 1 }))[0];
    const flag = `login-intro:${c.userId}`;
    const justLoggedIn = !!(await this.state.get(flag));
    if (justLoggedIn) await this.state.del(flag);
    // askLocation: login novo → o app pede o GPS (ou a cidade, se o navegador negar)
    if (!justLoggedIn && last && Date.now() - new Date(last.createdAt).getTime() < OPEN_MENU_AFTER_MS) return { opened: false, askLocation: false };
    this.chat.typing(c.userId, true);
    void this.assistant
      .openMenu(c, APP_INSTANCE)
      .catch(() => undefined)
      .finally(() => this.chat.typing(c.userId, false));
    return { opened: true, askLocation: justLoggedIn };
  }

  /** O navegador deu a posição (GPS): atualiza a cidade do clima; o chat só avisa se ela mudou. */
  @Post("location")
  async location(@Request() req: any, @Body() body: { lat?: number; lng?: number }) {
    if (typeof body?.lat !== "number" || typeof body?.lng !== "number") throw new BadRequestException("Posição inválida.");
    const c = await this.commander(req);
    await this.assistant.handleDeviceLocation(c, APP_INSTANCE, { lat: body.lat, lng: body.lng });
    return { ok: true };
  }

  /** Sem GPS (negado, sem suporte ou erro): o assistente pergunta em que cidade a pessoa está. */
  @Post("location/denied")
  async locationDenied(@Request() req: any) {
    const c = await this.commander(req);
    await this.assistant.askCity(c, APP_INSTANCE);
    return { ok: true };
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

  /** Áudio gravado no app: vira texto (como no WhatsApp) e segue o mesmo caminho da mensagem escrita. */
  @Post("audio")
  async audio(@Request() req: any, @Body() body: { base64?: string; mime?: string; seconds?: number }) {
    const c = await this.commander(req);
    const mime = String(body?.mime ?? "").split(";")[0].trim().toLowerCase();
    const size = bytesOf(body?.base64);
    if (!/^audio\//.test(mime) && mime !== "video/webm") throw new BadRequestException("Formato de áudio não aceito.");
    if (!size) throw new BadRequestException("Áudio vazio.");
    if (size > MAX_MEDIA_BYTES) throw new BadRequestException("Áudio grande demais (limite de 15 MB).");
    const seconds = Math.max(0, Math.min(Number(body?.seconds) || 0, 3600));
    this.chat.typing(c.userId, true);
    const heard = await this.assistant.transcribeForApp(c, Buffer.from(body.base64!, "base64"), mime, seconds);
    if (!heard.text) {
      const msg = await this.chat.store(c, "IN", "TEXT", "🎙️ Áudio");
      await this.chat.deliver(c, heard.notice ?? "Não consegui entender o áudio.");
      return msg;
    }
    const msg = await this.chat.store(c, "IN", "TEXT", `🎙️ ${heard.text}`);
    void this.assistant
      .handle(c, APP_INSTANCE, heard.text, { heard: true })
      .then((r) => (r?.redact ? this.chat.redact(msg.id, c) : undefined))
      .catch(() => undefined)
      .finally(() => this.chat.typing(c.userId, false));
    return msg;
  }

  /** Imagem ou PDF (convite, cartaz, nota): o assistente lê como faz no WhatsApp. O arquivo não é guardado. */
  @Post("file")
  async file(@Request() req: any, @Body() body: { base64?: string; mime?: string; name?: string; caption?: string }) {
    const c = await this.commander(req);
    const mime = String(body?.mime ?? "").toLowerCase();
    const size = bytesOf(body?.base64);
    if (!FILE_MIMES.test(mime)) throw new BadRequestException("Envie uma imagem (JPG, PNG, WebP) ou um PDF.");
    if (!size) throw new BadRequestException("Arquivo vazio.");
    if (size > MAX_MEDIA_BYTES) throw new BadRequestException("Arquivo grande demais (limite de 15 MB).");
    const name = String(body?.name ?? "arquivo").replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, 100) || "arquivo";
    const caption = typeof body?.caption === "string" ? body.caption.trim().slice(0, 500) : "";
    const msg = await this.chat.store(c, "IN", "TEXT", `📎 ${name}${caption ? `\n${caption}` : ""}`);
    this.chat.typing(c.userId, true);
    void this.assistant
      .handleMedia(c, APP_INSTANCE, async () => ({ base64: body.base64!, mimetype: mime }), { mime, caption })
      .catch(() => undefined)
      .finally(() => this.chat.typing(c.userId, false));
    return msg;
  }

  @Get("files/:id")
  async download(@Request() req: any, @Param("id") id: string, @Res() res: any) {
    const f = await this.chat.file(req.user.id, id);
    if (!f) throw new NotFoundException("Arquivo não encontrado ou expirado.");
    res.set({ "Content-Type": f.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.nome)}`, "X-Content-Type-Options": "nosniff" });
    res.send(f.bytes);
  }

  /**
   * Baixar um arquivo da lista do Drive: busca na hora, na conta Google do próprio usuário (nada fica guardado, então não expira).
   * Só vale para contas vinculadas ao workspace dele; o que passa do limite devolve o link do Drive.
   */
  @Get("drive/:id")
  async driveDownload(@Request() req: any, @Param("id") id: string, @Query("account") account: string | undefined, @Res() res: any) {
    const c = await this.commander(req);
    if (!/^[\w-]{10,100}$/.test(id)) throw new BadRequestException("Arquivo inválido.");
    const accounts: string[] = await this.google.listAccounts(c.workspaceId);
    const acc = account ? accounts.find((a) => a === account) : accounts[0];
    if (!acc) throw new NotFoundException("Conta do Google não encontrada.");
    let f: Awaited<ReturnType<GoogleService["driveFile"]>>;
    try {
      f = await this.google.driveFile(c.workspaceId, id, acc);
    } catch (e: any) {
      throw new NotFoundException(String(e?.message ?? "Não consegui abrir o arquivo no Drive.").slice(0, 200));
    }
    if (!f.base64) return res.status(422).json({ message: `Não consegui baixar ${f.nome}: ${f.motivo ?? "arquivo grande demais"}.`, link: f.link ?? null });
    res.set({ "Content-Type": f.mime || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.nome)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.send(Buffer.from(f.base64, "base64"));
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
