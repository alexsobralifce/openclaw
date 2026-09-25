import { Injectable, UnauthorizedException, ConflictException, ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@openclaw/database";
import * as bcrypt from "bcryptjs";
import { statusMessage } from "./jwt.strategy";
import { effectiveServices } from "./permissions";

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService) {}

  /**
   * Cada cadastro ganha o próprio workspace. O primeiro usuário do sistema vira ROOT;
   * os demais ficam pendentes até um ROOT/ADMIN aprovar e liberar os serviços.
   */
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
    const first = (await prisma.user.count()) === 0;

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: first ? "ROOT" : "USER",
        status: first ? "ACTIVE" : "PENDING",
        approvedAt: first ? new Date() : null,
        workspaces: {
          create: {
            role: "OWNER",
            workspace: { create: { name: workspaceName, slug: uniqueSlug } },
          },
        },
      },
      include: { workspaces: { include: { workspace: true } } },
    });

    if (user.status !== "ACTIVE") return { pending: true, message: statusMessage(user.status) };
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
    // Só depois de conferir a senha, para não revelar quais e-mails estão cadastrados
    if (user.status !== "ACTIVE") throw new ForbiddenException(statusMessage(user.status));

    return this.buildResponse(user);
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { workspaces: { include: { workspace: true } } },
    });
    if (!user) throw new UnauthorizedException();
    return this.view(user);
  }

  /** O próprio usuário cadastra o WhatsApp de onde vai falar com o assistente. */
  async updateProfile(userId: string, data: { name?: string; phone?: string | null }) {
    const phone = data.phone === undefined ? undefined : (data.phone ?? "").replace(/\D/g, "") || null;
    if (phone && (await prisma.user.findFirst({ where: { phone, NOT: { id: userId } } }))) {
      throw new ConflictException("Este WhatsApp já está cadastrado em outra conta");
    }
    await prisma.user.update({ where: { id: userId }, data: { ...(data.name ? { name: data.name } : {}), ...(phone !== undefined ? { phone } : {}) } });
    return this.me(userId);
  }

  private view(user: any) {
    const ws = user.workspaces?.[0];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
      phone: user.phone ?? null,
      workspaceId: ws?.workspaceId ?? null,
      workspaceName: ws?.workspace?.name ?? null,
      role: ws?.role ?? null,
      platformRole: user.role,
      services: effectiveServices(user.role, user.services),
    };
  }

  private buildResponse(user: any) {
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      user: this.view(user),
    };
  }
}
