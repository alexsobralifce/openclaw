import { BadGatewayException, BadRequestException, HttpException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { randomUUID } from "crypto";
import { MercadoPagoConfig, Payment, PreApproval, Preference } from "mercadopago";
import { isPlan, PLANS, planExpired } from "../auth/plans";
import { StateService } from "../state/state.service";
import { makeReference, nextPlanUntil, parseReference } from "./mp-utils";

export type PayMethod = "card" | "pix";

/** Cobrança do MagoBox pelo Mercado Pago: o usuário paga na página do Mercado Pago e a API confere cada aviso consultando o pagamento lá. */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private state: StateService) {}

  private client() {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) throw new ServiceUnavailableException("Cobrança ainda não configurada.");
    return new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } });
  }

  private webUrl() {
    return (process.env.WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
  }

  private notificationUrl() {
    return `${(process.env.API_URL || "http://localhost:3001").replace(/\/+$/, "")}/api/v1/billing/webhook`;
  }

  /** Plano atual, para o painel de assinatura (não confunde com `/auth/me`: aqui é o estado de cobrança). */
  async status(userId: string) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, plan: true, planUntil: true, planRequired: true, billingStatus: true } });
    return {
      plan: u?.plan ?? null,
      planUntil: u?.planUntil ?? null,
      billingStatus: u?.billingStatus ?? null,
      expired: !!u && planExpired(u),
      configured: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY || null,
    };
  }

  /** Assinatura recorrente direto pelo cartão (token do Card Brick do Mercado Pago), sem redirecionar. */
  async subscribeWithCard(userId: string, planId: string, cardToken: string): Promise<{ status: string }> {
    if (!isPlan(planId) || PLANS[planId].priceBrl <= 0) throw new BadRequestException("Plano inválido para assinatura.");
    const plan = PLANS[planId];
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new BadRequestException("Usuário não encontrado.");
    try {
      const sub = await new PreApproval(this.client()).create({
        body: {
          reason: `MagoBox · plano ${plan.name}`,
          external_reference: makeReference(userId, planId),
          payer_email: process.env.MERCADOPAGO_PAYER_EMAIL_OVERRIDE || user.email,
          card_token_id: cardToken,
          back_url: `${this.webUrl()}/dashboard/settings`,
          status: "authorized",
          auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: plan.priceBrl, currency_id: "BRL" },
        },
      });
      if (sub.id) await this.onSubscription({ id: sub.id, status: sub.status, external_reference: makeReference(userId, planId) });
      return { status: sub.status ?? "unknown" };
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`Mercado Pago recusou a assinatura no cartão: ${e?.message ?? e}`);
      throw new BadGatewayException(`O Mercado Pago recusou o cartão: ${e?.message ?? "erro desconhecido"}`);
    }
  }

  /** Pagamento único por Pix (o plano ainda é mensal; sem renovação automática como no cartão). */
  async createPix(userId: string, planId: string): Promise<{ qrCode: string; qrCodeBase64: string; expiresAt: string }> {
    if (!isPlan(planId) || PLANS[planId].priceBrl <= 0) throw new BadRequestException("Plano inválido para assinatura.");
    const plan = PLANS[planId];
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new BadRequestException("Usuário não encontrado.");
    const expires = new Date(Date.now() + 30 * 60_000);
    try {
      const pay = await new Payment(this.client()).create({
        body: {
          transaction_amount: plan.priceBrl,
          description: `MagoBox · plano ${plan.name} (1 mês)`,
          payment_method_id: "pix",
          payer: { email: process.env.MERCADOPAGO_PAYER_EMAIL_OVERRIDE || user.email },
          external_reference: makeReference(userId, planId),
          notification_url: this.notificationUrl(),
          date_of_expiration: expires.toISOString(),
        },
        requestOptions: { idempotencyKey: randomUUID() },
      });
      const data = pay.point_of_interaction?.transaction_data;
      if (!data?.qr_code || !data.qr_code_base64) throw new ServiceUnavailableException("O Mercado Pago não devolveu o código Pix.");
      return { qrCode: data.qr_code, qrCodeBase64: data.qr_code_base64, expiresAt: expires.toISOString() };
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      this.logger.warn(`Mercado Pago recusou o Pix: ${e?.message ?? e}`);
      throw new BadGatewayException(`O Mercado Pago não gerou o Pix: ${e?.message ?? "erro desconhecido"}`);
    }
  }

  /**
   * Confere na hora se algum pagamento aprovado ainda não foi processado (o painel chama isto enquanto
   * espera o aviso do Mercado Pago, que pode demorar). Não substitui o webhook, só antecipa.
   */
  async sync(userId: string) {
    const mp = this.client();
    for (const plan of Object.values(PLANS).filter((p) => p.priceBrl > 0)) {
      const found = await new Payment(mp).search({ options: { external_reference: makeReference(userId, plan.id), status: "approved", sort: "date_created", criteria: "desc", limit: 10 } as any });
      for (const pay of found.results ?? []) await this.onPayment(pay as any);
    }
    return this.status(userId);
  }

  /** Cria o checkout e devolve o endereço da página do Mercado Pago. */
  async checkout(userId: string, planId: string, method: PayMethod): Promise<{ url: string }> {
    if (!isPlan(planId) || PLANS[planId].priceBrl <= 0) throw new BadRequestException("Plano inválido para assinatura.");
    const plan = PLANS[planId];
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new BadRequestException("Usuário não encontrado.");
    const reference = makeReference(userId, planId);
    const back = `${this.webUrl()}/dashboard/settings`;
    const mp = this.client();

    if (method === "card") {
      const sub = await new PreApproval(mp).create({
        body: {
          reason: `MagoBox · plano ${plan.name}`,
          external_reference: reference,
          payer_email: user.email,
          back_url: back,
          status: "pending",
          auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: plan.priceBrl, currency_id: "BRL" },
        },
      });
      if (!sub.init_point) throw new ServiceUnavailableException("O Mercado Pago não devolveu o link de pagamento.");
      return { url: sub.init_point };
    }

    const pref = await new Preference(mp).create({
      body: {
        items: [{ id: planId, title: `MagoBox · plano ${plan.name} (1 mês)`, quantity: 1, unit_price: plan.priceBrl, currency_id: "BRL" }],
        payer: { email: user.email },
        external_reference: reference,
        notification_url: this.notificationUrl(),
        back_urls: { success: back, pending: back, failure: back },
        auto_return: "approved",
        payment_methods: { excluded_payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "ticket" }, { id: "atm" }], installments: 1 },
      },
    });
    if (!pref.init_point) throw new ServiceUnavailableException("O Mercado Pago não devolveu o link de pagamento.");
    return { url: pref.init_point };
  }

  /** Trata um aviso já autenticado. Sempre confere o estado real consultando o Mercado Pago, nunca o corpo do aviso. */
  async handleNotification(type: string, id: string) {
    const mp = this.client();
    this.logger.log(`[AUDIT] mp_aviso tipo=${type} id=${id}`);
    if (type === "payment") return this.onPayment(await new Payment(mp).get({ id }));
    if (type === "subscription_authorized_payment") {
      // Esse aviso não traz o pagamento, só o id do débito autorizado; é preciso buscar a assinatura dele à parte.
      const r = await fetch(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      });
      const ap: any = r.ok ? await r.json() : null;
      if (ap?.preapproval_id) return this.onSubscription(await new PreApproval(mp).get({ id: String(ap.preapproval_id) }));
      return;
    }
    if (type === "subscription_preapproval") return this.onSubscription(await new PreApproval(mp).get({ id }));
  }

  private async onPayment(pay: { id?: number; status?: string; external_reference?: string; transaction_amount?: number }) {
    if (pay.status !== "approved" || !pay.id) return;
    const ref = parseReference(pay.external_reference);
    if (!ref || !isPlan(ref.planId)) return;
    const plan = PLANS[ref.planId];
    if ((pay.transaction_amount ?? 0) + 0.01 < plan.priceBrl) {
      this.logger.warn(`[AUDIT] mp_valor_menor payment=${pay.id} user=${ref.userId} pago=${pay.transaction_amount} plano=${plan.priceBrl}`);
      return;
    }
    // O Mercado Pago repete avisos: cada pagamento só soma o período uma vez
    const key = `mp-paid:${pay.id}`;
    if (await this.state.get(key)) return;
    await this.state.set(key, 1, 90 * 24 * 3600 * 1000);
    const user = await prisma.user.findUnique({ where: { id: ref.userId }, select: { id: true, role: true, planUntil: true, plan: true } });
    if (!user) return;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        plan: plan.id,
        planUntil: nextPlanUntil(user.plan === plan.id ? user.planUntil : null),
        ...(user.role === "USER" ? { services: plan.services } : {}),
      },
    });
    this.logger.log(`[AUDIT] mp_plano_ativo user=${user.id} plano=${plan.id} payment=${pay.id}`);
  }

  private async onSubscription(sub: { id?: string; status?: string; external_reference?: string }) {
    const ref = parseReference(sub.external_reference);
    if (!ref || !sub.id) return;
    await prisma.user.updateMany({ where: { id: ref.userId }, data: { mpSubscriptionId: sub.id, billingStatus: sub.status ?? null } });
    // Assinatura autorizada: o primeiro débito já é aprovado junto, então sincroniza na hora em vez de esperar o aviso dele
    if (sub.status === "authorized") await this.sync(ref.userId);
  }
}
