import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import * as bcrypt from "bcryptjs";
import { EvolutionService } from "../channels/evolution/evolution.service";
import { canEditUser, effectiveServices, isService, PlatformRole, ROLE_DEFAULTS, UserStatus } from "../auth/permissions";

export interface UserPatch {
  name?: string;
  phone?: string | null;
  role?: PlatformRole;
  status?: UserStatus;
  services?: string[];
}

// Só dados cadastrais: o root/admin gerencia contas, mas não enxerga o conteúdo dos workspaces
const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  services: true,
  approvedAt: true,
  createdAt: true,
  workspaces: { select: { workspace: { select: { id: true, name: true } } } },
} as const;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private evolution: EvolutionService) {}

  /** Garante que exista um ROOT (instalações anteriores a esta versão não tinham). */
  async onModuleInit() {
    try {
      let root = await prisma.user.findFirst({ where: { role: "ROOT" } });
      if (!root) {
        const email = process.env.ROOT_EMAIL;
        const candidate = email
          ? await prisma.user.findUnique({ where: { email } })
          : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
        if (!candidate) return;
        root = await prisma.user.update({ where: { id: candidate.id }, data: { role: "ROOT", status: "ACTIVE", approvedAt: new Date() } });
        this.logger.warn(`${root.email} definido como ROOT da plataforma`);
      }
      // Migra o dono antigo do assistente (variável de ambiente) para o cadastro do root
      const legacy = (process.env.OWNER_WHATSAPP_NUMBER || "").replace(/\D/g, "");
      if (legacy && !root.phone && !(await prisma.user.findFirst({ where: { phone: legacy } }))) {
        await prisma.user.update({ where: { id: root.id }, data: { phone: legacy } });
        this.logger.warn(`WhatsApp do assistente (${legacy}) associado ao root`);
      }
    } catch (e: any) {
      this.logger.error(`Inicialização de usuários falhou: ${e.message}`);
    }
  }

  catalog() {
    return { defaults: ROLE_DEFAULTS };
  }

  async list(status?: string) {
    const rows = await prisma.user.findMany({
      where: status ? { status: status as UserStatus } : {},
      select: SELECT,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return rows.map((u) => this.view(u));
  }

  async get(id: string) {
    const u = await prisma.user.findUnique({ where: { id }, select: SELECT });
    if (!u) throw new NotFoundException("Usuário não encontrado");
    return this.view(u);
  }

  /** Cria uma conta já aprovada, com workspace próprio. */
  async create(actor: PlatformRole, data: { name: string; email: string; password: string; workspaceName?: string; role?: PlatformRole; services?: string[]; phone?: string }) {
    const role = data.role ?? "USER";
    if (!canEditUser(actor, "USER", role)) throw new ForbiddenException("Você não pode criar usuários com este nível");
    if (await prisma.user.findUnique({ where: { email: data.email } })) throw new ConflictException("Email já cadastrado");
    const phone = await this.checkPhone(data.phone);
    const wsName = data.workspaceName || data.name;
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await bcrypt.hash(data.password, 12),
        phone,
        role,
        status: "ACTIVE",
        approvedAt: new Date(),
        services: this.cleanServices(data.services ?? ROLE_DEFAULTS[role]),
        workspaces: {
          create: { role: "OWNER", workspace: { create: { name: wsName, slug: `${slugify(wsName)}-${Date.now().toString(36)}` } } },
        },
      },
      select: SELECT,
    });
    return this.view(user);
  }

  async update(actorId: string, actor: PlatformRole, id: string, patch: UserPatch) {
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("Usuário não encontrado");
    if (target.id === actorId) throw new ForbiddenException("Use seu perfil para alterar os próprios dados");
    if (!canEditUser(actor, target.role, patch.role)) throw new ForbiddenException("Você não pode alterar este usuário");

    const phone = patch.phone === undefined ? undefined : await this.checkPhone(patch.phone, id);
    const approving = patch.status === "ACTIVE" && target.status === "PENDING";
    const u = await prisma.user.update({
      where: { id },
      data: {
        ...(patch.name ? { name: patch.name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(patch.role ? { role: patch.role } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        ...(approving ? { approvedAt: new Date() } : {}),
        ...(patch.services ? { services: this.cleanServices(patch.services) } : {}),
      },
      select: SELECT,
    });
    this.logger.log(`[AUDIT] usuário ${target.email} alterado por ${actorId}: ${Object.keys(patch).join(", ")}`);
    if (approving) await this.warnBackup();
    return this.view(u);
  }

  /** Remove a conta e o workspace dela (com todo o conteúdo) e desliga os WhatsApps conectados. */
  async remove(actorId: string, actor: PlatformRole, id: string) {
    const target = await prisma.user.findUnique({ where: { id }, include: { workspaces: true } });
    if (!target) throw new NotFoundException("Usuário não encontrado");
    if (target.id === actorId || !canEditUser(actor, target.role)) throw new ForbiddenException("Você não pode excluir este usuário");

    const wsIds = target.workspaces.map((w) => w.workspaceId);
    // Só apaga workspaces em que ele é o único membro
    const owned: string[] = [];
    for (const wsId of wsIds) if ((await prisma.workspaceMember.count({ where: { workspaceId: wsId } })) === 1) owned.push(wsId);

    const whatsapps = await prisma.channel.findMany({ where: { workspaceId: { in: owned }, type: "WHATSAPP" } });
    for (const ch of whatsapps) {
      await this.evolution.deleteInstance((ch.config as any)?.instanceName).catch((e) => this.logger.warn(`Instância não removida: ${e.message}`));
    }
    await prisma.$transaction([prisma.workspace.deleteMany({ where: { id: { in: owned } } }), prisma.user.delete({ where: { id } })]);
    this.logger.warn(`[AUDIT] usuário ${target.email} excluído por ${actorId} (workspaces: ${owned.length})`);
    return { ok: true };
  }

  /** Lembrete: com mais de BACKUP_USERS_THRESHOLD usuários ativos o projeto deixa de ser só teste (ver docs/operacao.md). */
  private async warnBackup() {
    const threshold = Number(process.env.BACKUP_USERS_THRESHOLD || 5);
    const active = await prisma.user.count({ where: { status: "ACTIVE" } });
    if (active > threshold) {
      this.logger.warn(`[BACKUP] ${active} usuários ativos (limite ${threshold}): configure o backup diário do Postgres — veja docs/operacao.md`);
    }
  }

  private cleanServices(list: string[]) {
    const bad = list.filter((s) => !isService(s));
    if (bad.length) throw new BadRequestException(`Serviços inválidos: ${bad.join(", ")}`);
    return [...new Set(list)];
  }

  private async checkPhone(raw?: string | null, selfId?: string) {
    const phone = (raw ?? "").replace(/\D/g, "") || null;
    if (phone && (await prisma.user.findFirst({ where: { phone, ...(selfId ? { NOT: { id: selfId } } : {}) } }))) {
      throw new ConflictException("Este WhatsApp já está cadastrado em outra conta");
    }
    return phone;
  }

  private view(u: any) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      services: u.services,
      effectiveServices: effectiveServices(u.role, u.services),
      approvedAt: u.approvedAt,
      createdAt: u.createdAt,
      workspace: u.workspaces?.[0]?.workspace ?? null,
    };
  }
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "workspace";
}
