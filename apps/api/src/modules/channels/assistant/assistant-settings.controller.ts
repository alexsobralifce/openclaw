import { BadRequestException, Body, Controller, Get, Param, Post, Put, Request } from "@nestjs/common";
import { Access } from "../../auth/access";
import { GoogleService } from "../../integrations/google/google.service";
import { MenuService } from "./menu.service";
import { cleanTitle, cleanTopic, MAX_NOTE_BODY, storageAccount } from "./notes";

/** Configurações do assistente que o dono ajusta pelo painel. */
@Controller("assistant")
export class AssistantSettingsController {
  constructor(private menu: MenuService, private google: GoogleService) {}

  /** Itens do menu do WhatsApp a que o usuário tem acesso, marcando os que ele escondeu. */
  @Access("assistant")
  @Get("menu")
  async getMenu(@Request() req: any) {
    return { items: await this.menu.menuItems(this.workspace(req)) };
  }

  /** Itens que ficam fora da lista do menu (o comando escrito ou falado continua valendo). */
  @Access("assistant")
  @Put("menu")
  async setMenu(@Request() req: any, @Body() body: { hidden?: string[] }) {
    if (!Array.isArray(body?.hidden)) throw new BadRequestException("Informe a lista de itens ocultos (hidden).");
    const ws = this.workspace(req);
    await this.menu.setHiddenItems(ws, body.hidden);
    return { items: await this.menu.menuItems(ws) };
  }

  /** Notas por assunto (as mesmas do WhatsApp), com as notas de cada assunto. */
  @Access("drive")
  @Get("notes")
  async listNotes(@Request() req: any) {
    const ws = this.workspace(req);
    const account = await this.noteAccount(ws);
    const topics = await this.google.noteTopics(ws, account).catch((e) => this.fail(e));
    return {
      account,
      topics: await Promise.all(topics.map(async (t) => ({ ...t, notes: await this.google.notesIn(ws, t.id, account).catch(() => []) }))),
    };
  }

  @Access("drive")
  @Get("notes/:id")
  async readNote(@Request() req: any, @Param("id") id: string) {
    const ws = this.workspace(req);
    return this.google.noteRead(ws, id, await this.noteAccount(ws)).catch((e) => this.fail(e));
  }

  /** Cria uma nota de texto no assunto informado. */
  @Access("drive")
  @Post("notes")
  async createNote(@Request() req: any, @Body() body: { topic?: string; title?: string; content?: string }) {
    const content = String(body?.content ?? "").trim().slice(0, MAX_NOTE_BODY);
    if (!content) throw new BadRequestException("Escreva o conteúdo da nota.");
    const ws = this.workspace(req);
    const draft = { topic: cleanTopic(body?.topic), title: cleanTitle(body?.title || content.split(/[.\n]/)[0].slice(0, 60)), content };
    return this.google.noteCreate(ws, draft, process.env.ASSISTANT_TZ || "America/Fortaleza", await this.noteAccount(ws), "painel").catch((e) => this.fail(e));
  }

  private async noteAccount(ws: string): Promise<string> {
    const account = storageAccount(await this.google.listAccounts(ws));
    if (!account) throw new BadRequestException("Google não conectado. Conecte em Canais → Conectar Google.");
    return account;
  }

  private fail(e: any): never {
    throw new BadRequestException(String(e?.message ?? e));
  }

  private workspace(req: any): string {
    const ws = req.user.workspaces[0]?.workspaceId;
    if (!ws) throw new BadRequestException("Usuário sem workspace.");
    return ws;
  }
}
