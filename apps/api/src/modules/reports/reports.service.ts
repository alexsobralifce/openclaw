import { HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { MailService, mailHtml } from "../auth/mail.service";

export const REPORT_STATUSES = ["NOVO", "EM_ANALISE", "RESOLVIDO"] as const;
const MAX_PER_HOUR = 5;

/** Relatos de problema enviados pelos usuários: ficam numa lista do admin e o(s) root(s) recebem um aviso por e-mail. */
@Injectable()
export class ReportsService {
  constructor(private mail: MailService) {}

  async create(userId: string, input: { message: string; page?: string; userAgent?: string }) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (!user) throw new NotFoundException("Usuário não encontrado");
    const recent = await prisma.bugReport.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= MAX_PER_HOUR) throw new HttpException("Você já enviou vários relatos na última hora. Tente de novo mais tarde.", HttpStatus.TOO_MANY_REQUESTS);
    const report = await prisma.bugReport.create({
      data: { userId, userName: user.name, userEmail: user.email, message: input.message.trim(), page: input.page?.slice(0, 200) || null, userAgent: input.userAgent?.slice(0, 300) || null },
    });
    await this.notifyRoot(report).catch(() => undefined);
    return { id: report.id };
  }

  list(status?: string) {
    return prisma.bugReport.findMany({
      where: status && (REPORT_STATUSES as readonly string[]).includes(status) ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async setStatus(id: string, status: string) {
    const found = await prisma.bugReport.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException("Relato não encontrado");
    return prisma.bugReport.update({ where: { id }, data: { status } });
  }

  private async notifyRoot(r: { userName: string; userEmail: string; message: string; page: string | null }) {
    const roots = await prisma.user.findMany({ where: { role: "ROOT", status: "ACTIVE" }, select: { email: true } });
    if (!roots.length) return;
    const url = `${(process.env.WEB_URL || "http://localhost:3000").replace(/\/+$/, "")}/dashboard/relatos`;
    await this.mail.send(
      roots.map((x) => x.email),
      `Problema relatado por ${r.userName}`,
      mailHtml("Novo problema relatado", [`De: ${r.userName} (${r.userEmail})`, `Tela: ${r.page ?? "não informada"}`, r.message.slice(0, 1500)], { label: "Abrir os relatos", url }),
    );
  }
}
