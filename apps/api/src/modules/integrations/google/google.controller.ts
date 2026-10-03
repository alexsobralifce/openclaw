import { Controller, Get, Query, Request, Res, BadRequestException } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { randomBytes } from "crypto";
import { StateService } from "../../state/state.service";
import { LOGIN_TICKET_MS, loginTicketKey } from "../../auth/google-login";
import { Access } from "../../auth/access";
import { JwtService } from "@nestjs/jwt";
import { GoogleService } from "./google.service";

@Controller("integrations/google")
export class GoogleController {
  constructor(private google: GoogleService, private jwt: JwtService, private state: StateService) {}

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

  /** Início do "Entrar com Google" (pública): leva o navegador à tela de consentimento do Google. */
  @Get("login")
  login(@Res() res: any) {
    const web = process.env.WEB_URL || "http://localhost:3000";
    if (!this.google.isConfigured()) return res.redirect(`${web}/auth/login?motivo=${encodeURIComponent("Login com Google não está configurado.")}`);
    return res.redirect(this.google.loginUrl(this.jwt.sign({ purpose: "google-login" }, { expiresIn: "10m" })));
  }

  @Get("callback")
  async callback(@Query("code") code: string, @Query("state") state: string, @Query("error") error: string, @Res() res: any) {
    const web = process.env.WEB_URL || "http://localhost:3000";
    let payload: any;
    try {
      payload = this.jwt.verify(state);
    } catch {
      payload = null;
    }
    if (payload?.purpose === "google-login") return this.loginCallback(web, code, error, res);
    if (error || !code) return res.redirect(`${web}/dashboard/channels?google=error`);
    try {
      if (payload?.purpose !== "google-oauth") throw new Error("state inválido");
      await this.google.connect(payload.workspaceId, code);
      return res.redirect(`${web}/dashboard/channels?google=ok`);
    } catch (e: any) {
      // Só o aviso de limite do plano é mostrado ao usuário; qualquer outro erro continua genérico
      const motivo = /^O plano /.test(String(e?.message)) ? `&motivo=${encodeURIComponent(e.message)}` : "";
      return res.redirect(`${web}/dashboard/channels?google=error${motivo}`);
    }
  }

  /** Volta do "Entrar com Google": só entra quem já tem conta com este e-mail (verificado pelo Google) e ativa. A sessão sai por um ticket de uso único, nunca pela URL. */
  private async loginCallback(web: string, code: string | undefined, error: string | undefined, res: any) {
    const back = (motivo: string) => res.redirect(`${web}/auth/login?motivo=${encodeURIComponent(motivo)}`);
    if (error || !code) return back("Login com Google cancelado.");
    try {
      const { email, verified } = await this.google.loginIdentity(code);
      if (!verified) return back("O Google não confirmou o e-mail desta conta.");
      const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, status: true } });
      if (!user) return back("Não há conta no MagoBox com este e-mail do Google. Crie a conta primeiro.");
      if (user.status !== "ACTIVE") return back(user.status === "PENDING" ? "Seu cadastro está aguardando aprovação do administrador." : "Sua conta está desativada. Fale com o administrador.");
      const ticket = randomBytes(24).toString("hex");
      await this.state.set(loginTicketKey(ticket), { userId: user.id }, LOGIN_TICKET_MS);
      return res.redirect(`${web}/auth/google?ticket=${ticket}`);
    } catch {
      return back("Não foi possível entrar com o Google. Tente de novo.");
    }
  }
}
