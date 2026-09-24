import { CanActivate, ExecutionContext, HttpException, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyContext, SCOPES_KEY } from "./scopes";

const WINDOW_MS = 60_000;
const TOUCH_EVERY_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private hits = new Map<string, { start: number; count: number }>();
  private touched = new Map<string, number>();

  constructor(
    private keys: ApiKeysService,
    private reflector: Reflector,
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

    this.limit(key.id, key.rateLimit, ctx);

    const now = Date.now();
    if (now - (this.touched.get(key.id) ?? 0) > TOUCH_EVERY_MS) {
      this.touched.set(key.id, now);
      void this.keys.touch(key.id);
    }

    req.apiKey = { id: key.id, workspaceId: key.workspaceId, scopes: key.scopes } satisfies ApiKeyContext;
    return true;
  }

  /** Limite por minuto (janela fixa, em memória por instância). */
  private limit(id: string, max: number, ctx: ExecutionContext) {
    const now = Date.now();
    const h = this.hits.get(id);
    if (!h || now - h.start >= WINDOW_MS) {
      this.hits.set(id, { start: now, count: 1 });
      return;
    }
    h.count++;
    if (h.count > max) {
      const retry = Math.ceil((h.start + WINDOW_MS - now) / 1000);
      ctx.switchToHttp().getResponse().setHeader("Retry-After", String(retry));
      throw new HttpException("Limite de requisições excedido", 429);
    }
  }
}
