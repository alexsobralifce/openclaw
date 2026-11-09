import { BadRequestException, Body, Controller, Get, Put, Request } from "@nestjs/common";
import { Access } from "../../auth/access";
import { GoogleService } from "../../integrations/google/google.service";
import { prisma } from "@magobox/database";
import { MemoryService } from "./memory.service";
import { MenuService } from "./menu.service";
import { todayItems, when } from "./routine";

/** Configurações do assistente que o dono ajusta pelo painel. */
@Controller("assistant")
export class AssistantSettingsController {
  constructor(private menu: MenuService, private google: GoogleService, private memory: MemoryService) {}

  /** Números para o resumo do painel: rotina (com os itens de hoje) e quantos fatos o assistente guarda na memória. Nada de conteúdo sensível. */
  @Access("assistant")
  @Get("overview")
  async overview(@Request() req: any) {
    const ws = this.workspace(req);
    const routine = await this.memory.listRoutine(ws);
    const weekday = new Date(new Date().toLocaleString("en-US", { timeZone: process.env.ASSISTANT_TZ || "America/Fortaleza" })).getDay();
    const today = todayItems(routine, weekday).slice(0, 5).map((i) => ({ topic: i.topic, when: when(i) }));
    const memories = await prisma.memory.count({ where: { workspaceId: ws, kind: { not: "routine" } } });
    return { routine: { total: routine.length, today }, memories };
  }

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

  private workspace(req: any): string {
    const ws = req.user.workspaces[0]?.workspaceId;
    if (!ws) throw new BadRequestException("Usuário sem workspace.");
    return ws;
  }
}
