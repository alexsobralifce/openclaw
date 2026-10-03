import { Controller, ForbiddenException, Get, Query, Request } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { Access } from "../auth/access";
import { dayStamp } from "../channels/assistant/notes";
import { loadPrices, monthlyLimitUsd, monthSpend, rollup, SYSTEM_USER } from "../channels/assistant/usage";

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
    const prices = loadPrices();
    const monthStart = `${dayStamp(new Date(), TZ).slice(0, 7)}-01`;
    const month = monthSpend(await prisma.aiUsage.findMany({ where: { day: { gte: monthStart } } }), prices);
    const today = dayStamp(new Date(), TZ);
    const r = rollup(rows, prices, today);
    // Quem ainda não usou nada também aparece (com zero): dá para ver o cadastro novo antes do primeiro consumo
    const people = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, createdAt: true } });
    const byId = new Map(people.map((p) => [p.id, p]));
    const used = new Set(r.users.map((u) => u.userId));
    const idle = people.filter((p) => !used.has(p.id)).map((p) => ({ userId: p.id, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, byProvider: {}, lastDay: "", firstDay: "", costUsd: 0, unpricedTokens: 0, monthlyUsd: 0 }));
    const users = [...r.users, ...idle].map((u) => {
      const p = byId.get(u.userId);
      return { ...u, monthUsd: month.get(u.userId) ?? 0, name: p?.name ?? (u.userId === SYSTEM_USER ? "Sistema (rotinas automáticas)" : "Usuário removido"), email: p?.email ?? null, role: p?.role ?? null, status: p?.status ?? null, since: p?.createdAt ?? null };
    });
    // Média só entre quem de fato usou (o Sistema não é cliente)
    const active = users.filter((u) => u.userId !== SYSTEM_USER && u.totalTokens > 0);
    const avgMonthlyUsd = active.length ? active.reduce((s, u) => s + u.monthlyUsd, 0) / active.length : 0;
    return {
      days,
      since,
      total: { ...r.total, costUsd: r.users.reduce((s, u) => s + u.costUsd, 0), unpricedTokens: r.users.reduce((s, u) => s + u.unpricedTokens, 0) },
      avgMonthlyUsd,
      monthlyLimitUsd: monthlyLimitUsd(),
      activeUsers: active.length,
      usdBrl: Number(process.env.AI_USD_BRL) > 0 ? Number(process.env.AI_USD_BRL) : null,
      pricedModels: Object.keys(prices),
      byDay: r.byDay,
      users,
    };
  }
}
