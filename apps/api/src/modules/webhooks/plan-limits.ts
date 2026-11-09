/** Limites da API por plano do workspace. */
export const PLAN_LIMITS: Record<string, { keys: number; webhooks: number; rateLimit: number }> = {
  FREE: { keys: 2, webhooks: 2, rateLimit: 60 },
  STARTER: { keys: 5, webhooks: 5, rateLimit: 300 },
  GROWTH: { keys: 20, webhooks: 20, rateLimit: 1000 },
  ENTERPRISE: { keys: 100, webhooks: 100, rateLimit: 6000 },
};

export const limitsFor = (plan: string) => PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;
