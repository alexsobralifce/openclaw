import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, HttpException, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@openclaw/database";
import * as bcrypt from "bcryptjs";
import { statusMessage } from "./jwt.strategy";
import { effectiveServices } from "./permissions";
import { StateService } from "../state/state.service";
import { consumeToken, issueToken } from "./account-tokens";
import { MailService, mailHtml } from "./mail.service";

// Falhas de senha por e-mail: depois de tantas, a conta espera um tempo (vale mesmo com IPs diferentes)
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60_000;
// Cadastros aguardando aprovação: teto para o cadastro público não encher a fila do administrador
const MAX_PENDING = Number(process.env.MAX_PENDING_SIGNUPS || 30);

// Hash de uma senha qualquer, só para gastar o mesmo tempo quando o e-mail não existe
const DUMMY_HASH = bcrypt.hashSync("nao-e-uma-senha-real", 12);

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService, private state: StateService, private mail: MailService) {}

  private webUrl() {
    return (process.env.WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
  }

  /**
   * Cada cadastro ganha o próprio workspace. O primeiro usuário do sistema vira ROOT;
   * os demais ficam pendentes até um ROOT/ADMIN aprovar e liberar os serviços.
   */
  async register(email: string, name: string, password: string, workspaceName: string) {
    // O primeiro usuário (root) sempre pode se cadastrar; depois, há um teto de pendentes
    if ((await prisma.user.count()) > 0 && (await prisma.user.count({ where: { status: "PENDING" } })) >= MAX_PENDING) {
      throw new ServiceUnavailableException("Cadastros temporariamente indisponíveis. Fale com o administrador.");
    }
    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
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

    if (user.status !== "ACTIVE") {
      void this.sendVerifyEmail(user.id, user.email).catch(() => undefined);
      return { pending: true, message: `${statusMessage(user.status)} Enviamos um e-mail para você confirmar seu endereço.` };
    }
    return this.buildResponse(user);
  }

  private async sendVerifyEmail(userId: string, email: string) {
    const token = await issueToken(this.state, "verify-email", userId);
    const url = `${this.webUrl()}/auth/confirmar?token=${token}`;
    await this.mail.send(email, "Confirme seu e-mail — MagoBox", mailHtml("Confirme seu e-mail", ["Falta só confirmar seu e-mail para o cadastro seguir para aprovação."], { url, label: "Confirmar e-mail" }));
  }

  /** Link de cadastro: marca o e-mail como confirmado. Não aprova a conta — isso continua com o admin. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await consumeToken(this.state, "verify-email", token);
    if (!userId) throw new UnauthorizedException("Link inválido ou expirado.");
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }

  /**
   * Sempre responde do mesmo jeito, exista ou não o e-mail: a resposta não pode revelar quais contas existem.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, email: true, passwordHash: true } });
    if (!user || !user.passwordHash) return;
    const token = await issueToken(this.state, "reset-password", user.id);
    const url = `${this.webUrl()}/auth/redefinir?token=${token}`;
    await this.mail.send(user.email, "Redefinir senha — MagoBox", mailHtml("Redefinir senha", ["Pedimos um link para você criar uma nova senha. Se não foi você, ignore este e-mail."], { url, label: "Criar nova senha" }));
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await consumeToken(this.state, "reset-password", token);
    if (!userId) throw new UnauthorizedException("Link inválido ou expirado.");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async login(email: string, password: string) {
    const failKey = `login-fail:${email.toLowerCase()}`;
    if (((await this.state.get<number>(failKey)) ?? 0) >= MAX_FAILS) {
      throw new HttpException("Muitas tentativas para esta conta. Aguarde 15 minutos.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      include: { workspaces: { include: { workspace: true } } },
    });
    // Sempre compara a senha (mesmo sem usuário) para o tempo de resposta não revelar quais e-mails existem
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !valid) {
      await this.state.incr(failKey, FAIL_WINDOW_MS);
      throw new UnauthorizedException("Credenciais inválidas");
    }
    await this.state.del(failKey);
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
      // Ainda não viu o tour de boas-vindas: o painel mostra e marca como visto.
      onboarding: !user.onboardedAt,
    };
  }

  async onboardingDone(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { onboardedAt: new Date() } });
  }

  private buildResponse(user: any) {
    // login novo: o app mostra as instruções e o menu na próxima abertura, mesmo que a conversa seja recente
    void this.state.set(`login-intro:${user.id}`, 1, 24 * 3600_000).catch(() => undefined);
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      user: this.view(user),
    };
  }
}
