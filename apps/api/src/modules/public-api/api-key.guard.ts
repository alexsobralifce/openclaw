import { CanActivate, ExecutionContext, HttpException, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiKeysService } from "./api-keys.service";
import { prisma } from "@openclaw/database";
import { ApiKeyContext, SCOPES_KEY } from "./scopes";
import { StateService } from "../state/state.service";
import { effectiveServices, serviceForScope, SERVICES } from "../auth/permissions";

const WINDOW_MS = 60_000;
const TOUCH_EVERY_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private touched = new Map<string, number>();

  constructor(
    private keys: ApiKeysService,
    private reflector: Reflector,
    private state: StateService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const raw = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!raw) throw new UnauthorizedException("Chave de API ausente");

    const key = await this.keys.validate(raw);
    if (!key) throw new UnauthorizedException("Chave de API inválida, expirada ou revogada");

    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const missing = required.filter((s) => !key.scopes.includes(s));
    if (missing.length) throw new ForbiddenException(`Escopo insuficiente. Necessário: ${missing.join(", ")}`);

    await this.checkOwner(key.workspaceId, ["api", ...required.map(serviceForScope)]);
    await this.limit(key.id, key.rateLimit, ctx);

    const now = Date.now();
    if (now - (this.touched.get(key.id) ?? 0) > TOUCH_EVERY_MS) {
      this.touched.set(key.id, now);
      void this.keys.touch(key.id);
    }

    req.apiKey = { id: key.id, workspaceId: key.workspaceId, scopes: key.scopes } satisfies ApiKeyContext;
    return true;
  }

  /** A chave herda as restrições do dono do workspace: conta ativa e serviços liberados pelo administrador. */
  private async checkOwner(workspaceId: string, needed: string[]) {
    const owner = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: "OWNER" }, include: { user: true } });
    if (!owner || owner.user.status !== "ACTIVE") throw new ForbiddenException("Conta do workspace inativa ou aguardando aprovação");
    const allowed: string[] = effectiveServices(owner.user.role, owner.user.services);
    const missing = [...new Set(needed)].filter((s) => !allowed.includes(s));
    if (missing.length) {
      throw new ForbiddenException(`Serviço não liberado para esta conta: ${missing.map((s) => SERVICES[s as keyof typeof SERVICES]).join(", ")}`);
    }
  }

  /** Limite por minuto (janela fixa, compartilhada entre instâncias pelo banco). */
  private async limit(id: string, max: number, ctx: ExecutionContext) {
    const now = Date.now();
    const window = Math.floor(now / WINDOW_MS);
    const count = await this.state.incr(`rl:key:${id}:${window}`, WINDOW_MS * 2);
    if (count > max) {
      const retry = Math.ceil(((window + 1) * WINDOW_MS - now) / 1000);
      ctx.switchToHttp().getResponse().setHeader("Retry-After", String(retry));
      throw new HttpException("Limite de requisições excedido", 429);
    }
  }
}
