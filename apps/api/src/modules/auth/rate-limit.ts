import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { StateService } from "../state/state.service";

const KEY = "rate-limit";

/** Limita quantas vezes um mesmo IP pode chamar a rota dentro da janela (contador compartilhado no banco). */
export const RateLimit = (name: string, limit: number, windowSec: number) => SetMetadata(KEY, { name, limit, windowSec });

/** Barreira simples contra força bruta e cadastros em massa. O IP vem do `trust proxy` configurado no main.ts. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private reflector: Reflector, private state: StateService) {}

  async canActivate(ctx: ExecutionContext) {
    const rule = this.reflector.get<{ name: string; limit: number; windowSec: number }>(KEY, ctx.getHandler());
    if (!rule) return true;
    const req = ctx.switchToHttp().getRequest();
    const windowMs = rule.windowSec * 1000;
    const bucket = Math.floor(Date.now() / windowMs);
    const count = await this.state.incr(`rl:${rule.name}:${req.ip}:${bucket}`, windowMs * 2);
    if (count > rule.limit) {
      const retry = Math.ceil(((bucket + 1) * windowMs - Date.now()) / 1000);
      ctx.switchToHttp().getResponse().setHeader("Retry-After", String(retry));
      throw new HttpException("Muitas tentativas. Aguarde alguns minutos e tente de novo.", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
