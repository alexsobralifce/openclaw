import { Injectable, UnauthorizedException, ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@openclaw/database";
import * as bcrypt from "bcryptjs";

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService) {}

  async register(email: string, name: string, password: string, workspaceName: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("Email já cadastrado");

    const passwordHash = await bcrypt.hash(password, 12);
    const slug = workspaceName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40);

    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        workspaces: {
          create: {
            role: "OWNER",
            workspace: { create: { name: workspaceName, slug: uniqueSlug } },
          },
        },
      },
      include: { workspaces: { include: { workspace: true } } },
    });

    return this.buildResponse(user);
  }

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { workspaces: { include: { workspace: true } } },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException("Credenciais inválidas");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Credenciais inválidas");

    return this.buildResponse(user);
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { workspaces: { include: { workspace: true } } },
    });
    if (!user) throw new UnauthorizedException();
    const ws = user.workspaces[0];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      workspaceId: ws?.workspaceId ?? null,
      workspaceName: ws?.workspace?.name ?? null,
      role: ws?.role ?? null,
    };
  }

  private buildResponse(user: any) {
    const ws = user.workspaces?.[0];
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        workspaceId: ws?.workspaceId ?? null,
        workspaceName: ws?.workspace?.name ?? null,
        role: ws?.role ?? null,
      },
    };
  }
}
