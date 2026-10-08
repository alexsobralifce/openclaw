import { Body, Controller, Get, Headers, HttpCode, Logger, Post, Query, Request, UseGuards } from "@nestjs/common";
import { IsIn, IsString } from "class-validator";
import { Access, AllowExpired } from "../auth/access";
import { PLAN_IDS, PLANS } from "../auth/plans";
import { RateLimit, RateLimitGuard } from "../auth/rate-limit";
import { BillingService } from "./billing.service";
import { verifyMpSignature } from "./mp-utils";

class CheckoutDto {
  @IsString() @IsIn(PLAN_IDS) plan!: string;
  @IsIn(["card", "pix"]) method!: "card" | "pix";
}

@Controller("billing")
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private billing: BillingService) {}

  /** Planos à venda e a situação da assinatura do usuário. */
  @Access()
  @AllowExpired()
  @Get("me")
  async mine(@Request() req: any) {
    return { plans: Object.values(PLANS).filter((p) => p.priceBrl > 0), ...(await this.billing.status(req.user.id)) };
  }

  /** Confere os pagamentos no Mercado Pago e ativa o plano se o aviso (webhook) ainda não chegou. */
  @Access()
  @AllowExpired()
  @UseGuards(RateLimitGuard)
  @RateLimit("billing-sync", 30, 3600)
  @Post("sync")
  @HttpCode(200)
  sync(@Request() req: any) {
    return this.billing.sync(req.user.id);
  }

  /** Começa a assinatura: devolve o endereço do checkout do Mercado Pago. Aberto também com a assinatura vencida (é como se renova). */
  @Access()
  @AllowExpired()
  @UseGuards(RateLimitGuard)
  @RateLimit("checkout", 20, 3600)
  @Post("checkout")
  checkout(@Request() req: any, @Body() dto: CheckoutDto) {
    return this.billing.checkout(req.user.id, dto.plan, dto.method);
  }

  /** Aviso do Mercado Pago (público, mas só vale com a assinatura secreta correta). */
  @HttpCode(200)
  @Post("webhook")
  async webhook(
    @Body() body: any,
    @Query() query: Record<string, string>,
    @Headers("x-signature") signature?: string,
    @Headers("x-request-id") requestId?: string,
  ) {
    const dataId = String(query["data.id"] ?? body?.data?.id ?? "");
    const type = String(query.type ?? query.topic ?? body?.type ?? "");
    const ok = verifyMpSignature({ secret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "", signature, requestId, dataId });
    if (!ok) {
      // 200 mesmo assim: não revela nada a quem não é o Mercado Pago; o registro ajuda a achar assinatura secreta errada
      this.logger.warn(`[AUDIT] mp_aviso_recusado tipo=${type} id=${dataId} assinatura=${signature ? "presente" : "ausente"}`);
      return { ok: false };
    }
    await this.billing.handleNotification(type, dataId); // erro vira 500: o Mercado Pago tenta de novo
    return { ok: true };
  }
}
