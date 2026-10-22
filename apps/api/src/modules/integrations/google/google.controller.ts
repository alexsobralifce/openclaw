import { Controller, Get, Query, Request, Res, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { Access } from "../../auth/access";
import { JwtService } from "@nestjs/jwt";
import { GoogleService } from "./google.service";
import { AuthService } from "../../auth/auth.service";

@Controller("integrations/google")
export class GoogleController {
  constructor(private google: GoogleService, private jwt: JwtService, private auth: AuthService) {}

  /**
   * "Entrar com Google" (login/cadastro), diferente de "auth-url" (conectar Drive/Gmail de quem
   * já está logado). Mesmo endereço de volta (GOOGLE_REDIRECT_URI é único); o "purpose" no state
   * decide o que o callback faz.
   */
  @Get("login")
  async loginRedirect(@Res() res: any) {
    const web = process.env.WEB_URL || "http://localhost:3000";
    if (!this.google.isConfigured()) return res.redirect(`${web}/auth/login?motivo=${encodeURIComponent("Login pelo Google ainda não está configurado.")}`);
    const state = this.jwt.sign({ purpose: "login" }, { expiresIn: "10m" });
    return res.redirect(this.google.loginUrl(state));
  }

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
    let payload: any;
    try {
      payload = this.jwt.verify(state);
    } catch {
      return res.redirect(`${web}/dashboard/channels?google=error`);
    }

    if (payload.purpose === "login") return this.loginCallback(code, res, web);

    try {
      if (payload.purpose !== "google-oauth") throw new Error("state inválido");
      await this.google.connect(payload.workspaceId, code);
      return res.redirect(`${web}/dashboard/channels?google=ok`);
    } catch (e: any) {
      // Só o aviso de limite do plano é mostrado ao usuário; qualquer outro erro continua genérico
      const motivo = /^O plano /.test(String(e?.message)) ? `&motivo=${encodeURIComponent(e.message)}` : "";
      return res.redirect(`${web}/dashboard/channels?google=error${motivo}`);
    }
  }

  private async loginCallback(code: string, res: any, web: string) {
    try {
      const { email, verified, name } = await this.google.loginIdentity(code);
      if (!verified) throw new Error("O Google não confirma este e-mail.");
      const result: any = await this.auth.loginWithGoogle(email, name);
      if (result.pending) return res.redirect(`${web}/auth/login?motivo=${encodeURIComponent(result.message)}`);
      const ticket = await this.auth.issueGoogleTicket(result);
      return res.redirect(`${web}/auth/google?ticket=${ticket}`);
    } catch (e: any) {
      return res.redirect(`${web}/auth/login?motivo=${encodeURIComponent(e?.message || "Não foi possível entrar com o Google.")}`);
    }
  }
}
