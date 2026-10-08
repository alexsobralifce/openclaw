// Planos comerciais do MagoBox e os limites de cada um (lógica pura). Quem não tem plano segue os limites gerais do ambiente.
import { Service } from "./permissions";

export interface PlanDef {
  id: string;
  name: string;
  priceBrl: number;
  /** Teto de gasto de IA por mês, em US$. */
  aiUsd: number;
  googleAccounts: number;
  pdfPages: number;
  audioSeconds: number;
  /** Serviços liberados quando o admin escolhe o plano (o admin ainda pode ajustar depois). */
  services: Service[];
  summary: string;
}

const BASE: Service[] = ["assistant", "email", "calendar", "drive", "contacts", "channels"];

/** Valores da proposta de preços (R$ 9,90 / 29,90 / 69,90). O teto de IA segue a regra teto(R$) ≤ 0,6 × preço − 2. */
export const PLANS: Record<string, PlanDef> = {
  teste: { id: "teste", name: "Teste", priceBrl: 0, aiUsd: 0.4, googleAccounts: 1, pdfPages: 15, audioSeconds: 60, services: BASE, summary: "7 dias para experimentar, com teto de IA baixo (a data de fim ainda é controlada pelo admin)" },
  aprendiz: { id: "aprendiz", name: "Aprendiz", priceBrl: 9.9, aiUsd: 0.7, googleAccounts: 1, pdfPages: 15, audioSeconds: 60, services: BASE, summary: "E-mail, agenda, notas, Drive e contatos" },
  mago: { id: "mago", name: "Mago", priceBrl: 29.9, aiUsd: 2.5, googleAccounts: 3, pdfPages: 50, audioSeconds: 180, services: [...BASE, "vault"], summary: "Tudo do Aprendiz, mais rotina, memória e cofre de senhas" },
  arquimago: { id: "arquimago", name: "Arquimago", priceBrl: 69.9, aiUsd: 6, googleAccounts: 10, pdfPages: 80, audioSeconds: 300, services: [...BASE, "vault", "inbox", "automations", "api"], summary: "Tudo do Mago, mais caixa de clientes, API, webhooks e automações" },
};

export const PLAN_IDS = Object.keys(PLANS);
export const isPlan = (id: unknown): id is string => typeof id === "string" && Object.prototype.hasOwnProperty.call(PLANS, id);
/** O plano do usuário, ou null se não tem (ou se o valor guardado não existe mais). */
export const planOf = (id?: string | null): PlanDef | null => (isPlan(id) ? PLANS[id] : null);

/** Assinatura vencida: só vale para usuário comum com plano e data de vencimento (admin e root nunca pausam; sem data = sem vencimento). */
export const planExpired = (u: { role?: string | null; plan?: string | null; planUntil?: Date | null }, now = new Date()): boolean =>
  u.role === "USER" && !!u.plan && !!u.planUntil && u.planUntil.getTime() < now.getTime();
