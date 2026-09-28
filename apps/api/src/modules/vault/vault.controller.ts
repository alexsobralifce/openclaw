import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Post, Put, Request, UseGuards } from "@nestjs/common";
import { Access } from "../auth/access";
import { RateLimit, RateLimitGuard } from "../auth/rate-limit";
import { VaultService } from "./vault.service";

const str = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v) throw new BadRequestException(`Informe ${what}.`);
  return v;
};

/** Respostas do cofre nunca ficam em cache do navegador ou de proxies. */
@Controller("vault")
@Access("vault")
export class VaultController {
  constructor(private vault: VaultService) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  status(@Request() req: any) {
    return this.vault.status(req.user.id);
  }

  @Post("setup")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-setup", 5, 3600)
  @Header("Cache-Control", "no-store")
  setup(@Request() req: any, @Body() body: { password?: string }) {
    // Devolve a chave de recuperação: é a única vez que ela aparece
    return this.vault.setup(req.user.id, req.user.workspaces[0]?.workspaceId, str(body?.password, "a senha mestra"));
  }

  @Post("unlock")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-unlock", 20, 900)
  @Header("Cache-Control", "no-store")
  unlock(@Request() req: any, @Body() body: { password?: string; minutes?: number; whatsapp?: boolean }) {
    return this.vault.unlock(req.user.id, str(body?.password, "a senha mestra"), body?.minutes, body?.whatsapp === true);
  }

  @Post("lock")
  @Header("Cache-Control", "no-store")
  lock(@Request() req: any) {
    this.vault.lock(req.user.id);
    return { ok: true };
  }

  @Get("entries")
  @Header("Cache-Control", "no-store")
  list(@Request() req: any) {
    return this.vault.list(req.user.id);
  }

  @Get("entries/:id")
  @Header("Cache-Control", "no-store")
  reveal(@Request() req: any, @Param("id") id: string) {
    return this.vault.reveal(req.user.id, id);
  }

  @Post("entries")
  @Header("Cache-Control", "no-store")
  create(@Request() req: any, @Body() body: unknown) {
    return this.vault.save(req.user.id, undefined, body);
  }

  @Put("entries/:id")
  @Header("Cache-Control", "no-store")
  update(@Request() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.vault.save(req.user.id, id, body);
  }

  @Delete("entries/:id")
  @Header("Cache-Control", "no-store")
  async remove(@Request() req: any, @Param("id") id: string) {
    await this.vault.remove(req.user.id, id);
    return { ok: true };
  }

  @Post("verify")
  @Header("Cache-Control", "no-store")
  verify(@Request() req: any) {
    return this.vault.verify(req.user.id);
  }

  // ─── Esqueci a senha mestra ───────────────────────────────────

  @Post("recovery/request")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-reset-req", 5, 3600)
  @Header("Cache-Control", "no-store")
  requestReset(@Request() req: any) {
    return this.vault.requestReset(req.user.id);
  }

  @Post("recovery/complete")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-reset", 20, 900)
  @Header("Cache-Control", "no-store")
  recover(@Request() req: any, @Body() body: { token?: string; recoveryKey?: string; newPassword?: string }) {
    return this.vault.recoverWithKey(req.user.id, str(body?.token, "o link"), str(body?.recoveryKey, "a chave de recuperação"), str(body?.newPassword, "a nova senha mestra"));
  }

  @Post("recovery/reset")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-reset", 20, 900)
  @Header("Cache-Control", "no-store")
  resetEmpty(@Request() req: any, @Body() body: { token?: string; confirm?: string; newPassword?: string }) {
    return this.vault.resetEmpty(req.user.id, str(body?.token, "o link"), String(body?.confirm ?? ""), str(body?.newPassword, "a nova senha mestra"));
  }

  @Post("recovery-key")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-change", 10, 900)
  @Header("Cache-Control", "no-store")
  regenerateRecoveryKey(@Request() req: any, @Body() body: { password?: string }) {
    return this.vault.regenerateRecoveryKey(req.user.id, str(body?.password, "a senha mestra"));
  }

  @Post("change-master")
  @UseGuards(RateLimitGuard)
  @RateLimit("vault-change", 10, 900)
  @Header("Cache-Control", "no-store")
  async changeMaster(@Request() req: any, @Body() body: { oldPassword?: string; newPassword?: string }) {
    await this.vault.changeMaster(req.user.id, str(body?.oldPassword, "a senha mestra atual"), str(body?.newPassword, "a nova senha mestra"));
    return { ok: true };
  }
}
