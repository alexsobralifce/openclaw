import { Injectable, UnauthorizedException } from "@nestjs/common";
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
      secretOrKey: process.env.JWT_SECRET || "change-me-in-production",
    });
  }

  async validate(payload: JwtPayload) {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { workspaces: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
