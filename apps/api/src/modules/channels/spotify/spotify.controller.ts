import { BadRequestException, Controller, Delete, Get, Query, Request, Res } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Access } from "../../auth/access";
import { SpotifyService } from "./spotify.service";

/** Conexão do Spotify pelo painel (Canais). O callback é público, mas só aceita o `state` assinado por esta API (vale 10 minutos). */
@Controller("integrations/spotify")
export class SpotifyController {
  constructor(private spotify: SpotifyService, private jwt: JwtService) {}

  private ws = (req: any): string => req.user.workspaces[0]?.workspaceId;

  @Access("spotify")
  @Get("status")
  status(@Request() req: any) {
    return this.spotify.status(this.ws(req));
  }

  @Access("spotify")
  @Get("auth-url")
  authUrl(@Request() req: any) {
    if (!this.spotify.isConfigured()) throw new BadRequestException("O Spotify ainda não foi configurado neste servidor (SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET).");
    const state = this.jwt.sign({ workspaceId: this.ws(req), purpose: "spotify-oauth" }, { expiresIn: "10m" });
    return { url: this.spotify.authUrl(state) };
  }

  @Access("spotify")
  @Delete()
  async disconnect(@Request() req: any) {
    await this.spotify.disconnect(this.ws(req));
    return { connected: false };
  }

  @Get("callback")
  async callback(@Query("code") code: string, @Query("state") state: string, @Query("error") error: string, @Res() res: any) {
    const web = process.env.WEB_URL || "http://localhost:3000";
    const back = (r: string) => res.redirect(`${web}/dashboard/channels?spotify=${r}`);
    if (error || !code) return back("error");
    try {
      const payload: any = this.jwt.verify(state);
      if (payload.purpose !== "spotify-oauth") throw new Error("state inválido");
      await this.spotify.connect(payload.workspaceId, code);
      return back("ok");
    } catch {
      return back("error");
    }
  }
}
