import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { planExpired } from "./plans";
import { canManageUsers, effectiveServices, Service, SERVICES } from "./permissions";

const SERVICE_KEY = "access:service";
const ADMIN_KEY = "access:admin";
const EXPIRED_OK_KEY = "access:expired-ok";

/** Rota que continua aberta com a assinatura vencida (o perfil, o plano e a própria cobrança). */
export const AllowExpired = () => SetMetadata(EXPIRED_OK_KEY, true);

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const user = ctx.switchToHttp().getRequest().user;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_KEY, targets) && !canManageUsers(user.role)) {
      throw new ForbiddenException("Apenas administradores da plataforma");
    }
    if (planExpired(user) && !this.reflector.getAllAndOverride<boolean>(EXPIRED_OK_KEY, targets)) {
      const semPlano = !user.plan;
      throw new ForbiddenException({ statusCode: 403, code: "PLAN_EXPIRED", message: semPlano ? "Assine um plano em Configurações para começar a usar." : "Sua assinatura venceu. Renove em Configurações para voltar a usar." });
    }
    const service = this.reflector.getAllAndOverride<Service>(SERVICE_KEY, targets);
    if (service && !effectiveServices(user.role, user.services).includes(service)) {
      throw new ForbiddenException(`Serviço não liberado para sua conta: ${SERVICES[service]}. Fale com o administrador.`);
    }
    return true;
  }
}

/** Exige login e, se informado, que o serviço esteja liberado para o usuário. */
export const Access = (service?: Service) =>
  applyDecorators(...(service ? [SetMetadata(SERVICE_KEY, service)] : []), UseGuards(AuthGuard("jwt"), AccessGuard));

/** Exige login como ROOT ou ADMIN da plataforma. */
export const AdminOnly = () => applyDecorators(SetMetadata(ADMIN_KEY, true), UseGuards(AuthGuard("jwt"), AccessGuard));
