import { BadRequestException, Body, Controller, Get, Put, Request } from "@nestjs/common";
import { Access } from "../../auth/access";
import { MenuService } from "./menu.service";

/** Configurações do assistente que o dono ajusta pelo painel. */
@Controller("assistant")
export class AssistantSettingsController {
  constructor(private menu: MenuService) {}

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
