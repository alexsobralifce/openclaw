import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { prisma } from "@magobox/database";
import * as bcrypt from "bcryptjs";
import { statusMessage } from "./jwt.strategy";
import { effectiveServices } from "./permissions";
import { StateService } from "../state/state.service";
import { loginTicketKey } from "./google-login";
import { MailService, mailHtml } from "./mail.service";
import { consumeToken, issueToken } from "./account-tokens";
import { planOf } from "./plans";

// Falhas de senha por e-mail: depois de tantas, a conta espera um tempo (vale mesmo com IPs diferentes)
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60_000;
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
   * os demais entram na hora, mas sem acesso aos serviços até assinarem um plano ou um ROOT/ADMIN dar um (planRequired).
   */
  async register(email: string, name: string, password: string, workspaceName: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.createAccount(email, name, passwordHash, workspaceName);
    void this.afterSignup(user, "e-mail e senha");
    if (user.status !== "ACTIVE") return { pending: true, message: `${statusMessage(user.status)} Enviamos um e-mail para você confirmar seu endereço.` };
    return this.buildResponse(user);
  }

  /** Conta nova de quem entrou com o Google (sem senha): mesmas regras do cadastro: entra na hora, mas só usa depois de assinar ou ganhar um plano. */
  async registerFromGoogle(email: string, name: string) {
    const display = name.trim().slice(0, 80) || email.split("@")[0];
    // O Google já confirmou o e-mail
    const user = await this.createAccount(email, display, null, `Espaço de ${display.split(" ")[0]}`, true);
    void this.afterSignup(user, "Google");
    return user;
  }

  /** Depois do cadastro: pede a confirmação do e-mail (quem entrou por senha) e avisa o root. Falhas só vão para o log. */
  private async afterSignup(user: { id: string; email: string; name: string; plan?: string | null; role: string; status: string }, via: string) {
    try {
      if (via !== "Google") await this.sendVerification(user);
      if (user.role !== "ROOT") await this.notifyRoot(user, via);
    } catch (e: any) {
      console.warn(`Avisos do cadastro falharam: ${e.message}`);
    }
  }

  private async sendVerification(user: { id: string; email: string; name: string }) {
    const token = await issueToken(this.state, "verify-email", user.id);
    const url = `${this.webUrl()}/auth/confirmar?token=${token}`;
    await this.mail.send(user.email, "Confirme seu e-mail no MagoBox", mailHtml(`Olá, ${user.name.split(" ")[0]}!`, ["Confirme que este e-mail é seu para concluir o cadastro no MagoBox.", "Para usar o assistente, escolha um plano em Configurações.", "O link vale por 48 horas."], { label: "Confirmar e-mail", url }));
  }

  /** Todo cadastro novo avisa o(s) usuário(s) root. O cadastro não escolhe plano: ele assina sozinho ou o admin dá um plano (ex.: Teste, 7 dias). */
  private async notifyRoot(user: { email: string; name: string; plan?: string | null }, via: string) {
    const roots = await prisma.user.findMany({ where: { role: "ROOT", status: "ACTIVE" }, select: { email: true } });
    if (!roots.length) return;
    const plan = planOf(user.plan)?.name ?? "nenhum plano escolhido ainda";
    await this.mail.send(roots.map((r) => r.email), `Novo cadastro no MagoBox: ${user.name}`, mailHtml("Novo cadastro", [`Nome: ${user.name}`, `E-mail: ${user.email}`, `Plano: ${plan}`, `Entrou por: ${via}`], { label: "Abrir o painel", url: `${this.webUrl()}/dashboard` }));
  }

  /** Link de confirmação do e-mail. */
  async verifyEmail(token: string) {
    const userId = await consumeToken(this.state, "verify-email", token);
    if (!userId) throw new HttpException("Link inválido ou expirado. Peça um novo na tela de login.", HttpStatus.BAD_REQUEST);
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return { ok: true };
  }

  /** Esqueci a senha: responde sempre igual (não revela se o e-mail existe) e só envia para conta com senha. */
  async requestPasswordReset(email: string) {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (user?.passwordHash) {
      const token = await issueToken(this.state, "reset-password", user.id);
      await this.mail.send(user.email, "Redefinir sua senha do MagoBox", mailHtml("Redefinir senha", ["Recebemos um pedido para redefinir a senha da sua conta.", "O link vale por 1 hora. Se não foi você, ignore este e-mail: sua senha continua a mesma."], { label: "Criar nova senha", url: `${this.webUrl()}/auth/redefinir?token=${token}` }));
    }
    return { ok: true };
  }

  async resetPassword(token: string, password: string) {
    const userId = await consumeToken(this.state, "reset-password", token);
    if (!userId) throw new HttpException("Link inválido ou expirado. Peça um novo.", HttpStatus.BAD_REQUEST);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash, emailVerifiedAt: new Date() } });
    // Quem recebeu o link no e-mail prova que é dono dele; zera o bloqueio por tentativas erradas
    await this.state.del(`login-fail:${user.email.toLowerCase()}`);
    return { ok: true };
  }

  private async createAccount(email: string, name: string, passwordHash: string | null, workspaceName: string, emailVerified = false) {
    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (existing) throw new ConflictException("Email já cadastrado");

    const slug = workspaceName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40);

    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;
    const first = (await prisma.user.count()) === 0;

    return prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: first ? "ROOT" : "USER",
        status: "ACTIVE",
        approvedAt: new Date(),
        planRequired: !first,
        emailVerifiedAt: emailVerified || first ? new Date() : null,
        workspaces: {
          create: {
            role: "OWNER",
            workspace: { create: { name: workspaceName, slug: uniqueSlug } },
          },
        },
      },
      include: { workspaces: { include: { workspace: true } } },
    });
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

  /** Troca o ticket do login com Google (uso único, 60 s) pela sessão. */
  async loginWithGoogleTicket(ticket: string) {
    const key = loginTicketKey(ticket);
    const t = await this.state.get<{ userId: string }>(key);
    await this.state.del(key);
    const user = t && (await prisma.user.findUnique({ where: { id: t.userId }, include: { workspaces: { include: { workspace: true } } } }));
    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Login com Google expirado. Tente de novo.");
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

  /** Marca o tour de boas-vindas como visto (concluído ou pulado). */
  async finishOnboarding(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { onboardedAt: new Date() } });
    return { ok: true };
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
      plan: user.plan ?? null,
      assistantChannel: user.assistantChannel ?? "whatsapp",
      // Tour de boas-vindas: abre sozinho só para cadastro novo que ainda não o viu
      onboarding: !!user.planRequired && !user.onboardedAt,
    };
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
