import { Controller, Get, Query, Request, Res, BadRequestException } from "@nestjs/common";
import { Access } from "../../auth/access";
import { JwtService } from "@nestjs/jwt";
import { GoogleService } from "./google.service";

@Controller("integrations/google")
export class GoogleController {
  constructor(private google: GoogleService, private jwt: JwtService) {}

  @Access("channels")
  @Get("auth-url")
  async authUrl(@Request() req: any) {
    if (!this.google.isConfigured()) {
      throw new BadRequestException("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no .env");
    }
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const state = this.jwt.sign({ workspaceId, purpose: "google-oauth" }, { expiresIn: "10m" });
    return { url: this.google.authUrl(state), connected: await this.google.isConnected(workspaceId) };
  }

  @Access()
  @Get("status")
  async status(@Request() req: any) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    return { configured: this.google.isConfigured(), connected: await this.google.isConnected(workspaceId) };
  }

  @Get("callback")
  async callback(@Query("code") code: string, @Query("state") state: string, @Query("error") error: string, @Res() res: any) {
    const web = process.env.WEB_URL || "http://localhost:3000";
    if (error || !code) return res.redirect(`${web}/dashboard/channels?google=error`);
    try {
      const payload: any = this.jwt.verify(state);
      if (payload.purpose !== "google-oauth") throw new Error("state inválido");
      await this.google.connect(payload.workspaceId, code);
      return res.redirect(`${web}/dashboard/channels?google=ok`);
    } catch (e: any) {
      // Só o aviso de limite do plano é mostrado ao usuário; qualquer outro erro continua genérico
      const motivo = /^O plano /.test(String(e?.message)) ? `&motivo=${encodeURIComponent(e.message)}` : "";
      return res.redirect(`${web}/dashboard/channels?google=error${motivo}`);
    }
  }
}
