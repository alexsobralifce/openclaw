import { jwtSecret } from "../../config/jwt-secret";
import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { prisma } from "@openclaw/database";

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { workspaces: true },
    });
    if (!user) throw new UnauthorizedException();
    // Consultado a cada requisição: desativar um usuário corta o acesso na hora, mesmo com token válido
    if (user.status !== "ACTIVE") throw new ForbiddenException({ statusCode: 403, code: "ACCOUNT_INACTIVE", message: statusMessage(user.status) });
    return user;
  }
}

export function statusMessage(status: string) {
  return status === "PENDING"
    ? "Seu cadastro está aguardando aprovação do administrador."
    : "Sua conta está desativada. Fale com o administrador.";
}
