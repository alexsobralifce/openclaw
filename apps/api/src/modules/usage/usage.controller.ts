import { Controller, ForbiddenException, Get, Query, Request } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { Access, AllowExpired } from "../auth/access";
import { planOf } from "../auth/plans";
import { dayStamp } from "../channels/assistant/notes";
import { loadPrices, monthlyLimitUsd, monthSpend, rollup, SYSTEM_USER } from "../channels/assistant/usage";

const TZ = process.env.ASSISTANT_TZ || "America/Fortaleza";

/** Consumo de IA (tokens) de cada usuário. Só o root vê: é dado de todos os workspaces. */
/** Teto de IA no mês de um usuário em US$: o do plano, senão o geral do ambiente; 0 = sem limite (root, admin ou nada configurado). */
function limitFor(role?: string | null, plan?: string | null): number {
  if (role === "ROOT" || role === "ADMIN") return 0;
  return planOf(plan)?.aiUsd ?? monthlyLimitUsd();
}

@Controller("usage")
export class UsageController {
  /** O próprio usuário vê o plano, o teto e quanto já gastou de IA no mês. */
  @Access()
  @AllowExpired()
  @Get("me")
  async mine(@Request() req: any) {
    const prices = loadPrices();
    const monthStart = `${dayStamp(new Date(), TZ).slice(0, 7)}-01`;
    const spent = monthSpend(await prisma.aiUsage.findMany({ where: { userId: req.user.id, day: { gte: monthStart } } }), prices).get(req.user.id) ?? 0;
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, plan: true } });
    const plan = planOf(me?.plan);
    return { plan, limitUsd: limitFor(me?.role, me?.plan), monthUsd: spent, since: monthStart };
  }

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
    const people = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, plan: true, createdAt: true } });
    const byId = new Map(people.map((p) => [p.id, p]));
    const used = new Set(r.users.map((u) => u.userId));
    const idle = people.filter((p) => !used.has(p.id)).map((p) => ({ userId: p.id, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, byProvider: {}, lastDay: "", firstDay: "", costUsd: 0, unpricedTokens: 0, monthlyUsd: 0 }));
    const users = [...r.users, ...idle].map((u) => {
      const p = byId.get(u.userId);
      const limit = limitFor(p?.role, p?.plan);
      return { ...u, monthUsd: month.get(u.userId) ?? 0, plan: p?.plan ?? null, limitUsd: limit, name: p?.name ?? (u.userId === SYSTEM_USER ? "Sistema (rotinas automáticas)" : "Usuário removido"), email: p?.email ?? null, role: p?.role ?? null, status: p?.status ?? null, since: p?.createdAt ?? null };
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
