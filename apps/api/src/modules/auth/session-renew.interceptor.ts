import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Observable } from "rxjs";
import { SESSION_COOKIE, readCookie, setSessionCookie } from "./session-cookie";

const RENEW_AFTER_S = 24 * 3600;

/**
 * Sessão deslizante: quem usa o painel/app não é desconectado. Se o token do cookie tem mais de 1 dia, emite outro
 * (mais 180 dias) a partir do usuário já validado. Só mexe em quem se autenticou pelo cookie.
 */
@Injectable()
export class SessionRenewInterceptor implements NestInterceptor {
  constructor(private readonly jwt: JwtService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (ctx.getType() !== "http") return next.handle();
    const http = ctx.switchToHttp();
    const req: any = http.getRequest();
    const res: any = http.getResponse();
    try {
      const cookie = readCookie(req.headers?.cookie, SESSION_COOKIE);
      if (cookie && !req.headers?.authorization && req.user?.id && req.path !== "/api/v1/auth/logout") {
        const iat = (this.jwt.decode(cookie) as { iat?: number } | null)?.iat ?? 0;
        if (Date.now() / 1000 - iat > RENEW_AFTER_S) setSessionCookie(res, this.jwt.sign({ sub: req.user.id, email: req.user.email }));
      }
    } catch {
      // renovar é um extra: nunca derruba a requisição
    }
    return next.handle();
  }
}
