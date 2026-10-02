import { Controller, ForbiddenException, Get, Query, Request } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { Access } from "../auth/access";
import { dayStamp } from "../channels/assistant/notes";
import { rollup, SYSTEM_USER } from "../channels/assistant/usage";

const TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";

/** Consumo de IA (tokens) de cada usuário. Só o root vê: é dado de todos os workspaces. */
@Controller("usage")
export class UsageController {
  @Access()
  @Get()
  async report(@Request() req: any, @Query("days") daysRaw?: string) {
    if (req.user.role !== "ROOT") throw new ForbiddenException("Apenas o root vê o consumo de tokens.");
    const days = Math.min(Math.max(Math.trunc(Number(daysRaw)) || 30, 1), 365);
    const since = dayStamp(new Date(Date.now() - (days - 1) * 86_400_000), TZ);
    const rows = await prisma.aiUsage.findMany({ where: { day: { gte: since } } });
    const r = rollup(rows);
    const ids = r.users.map((u) => u.userId).filter((id) => id !== SYSTEM_USER);
    const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, role: true } });
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      days,
      since,
      total: r.total,
      byDay: r.byDay,
      users: r.users.map((u) => ({ ...u, name: byId.get(u.userId)?.name ?? (u.userId === SYSTEM_USER ? "Sistema (rotinas automáticas)" : "Usuário removido"), email: byId.get(u.userId)?.email ?? null, role: byId.get(u.userId)?.role ?? null })),
    };
  }
}
