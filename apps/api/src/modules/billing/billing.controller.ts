import { Body, Controller, Get, Headers, HttpCode, Post, Query, Request, UseGuards } from "@nestjs/common";
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

class SubscribeCardDto {
  @IsString() @IsIn(PLAN_IDS) plan!: string;
  @IsString() token!: string;
}

class PixDto {
  @IsString() @IsIn(PLAN_IDS) plan!: string;
}

@Controller("billing")
export class BillingController {
  constructor(private billing: BillingService) {}

  /** Começa a assinatura: devolve o endereço do checkout do Mercado Pago. Aberto também com a assinatura vencida (é como se renova). */
  @Access()
  @AllowExpired()
  @UseGuards(RateLimitGuard)
  @RateLimit("checkout", 20, 3600)
  @Post("checkout")
  checkout(@Request() req: any, @Body() dto: CheckoutDto) {
    return this.billing.checkout(req.user.id, dto.plan, dto.method);
  }

  /** Estado da assinatura + catálogo de planos pagos, para a tela de assinatura. */
  @Access()
  @AllowExpired()
  @Get("me")
  async me(@Request() req: any) {
    const status = await this.billing.status(req.user.id);
    const plans = Object.values(PLANS).filter((p) => p.priceBrl > 0);
    return { ...status, plans };
  }

  /** O painel chama enquanto espera o aviso do Mercado Pago, para não deixar o usuário preso na tela. */
  @Access()
  @AllowExpired()
  @UseGuards(RateLimitGuard)
  @RateLimit("billing-sync", 30, 3600)
  @Post("sync")
  sync(@Request() req: any) {
    return this.billing.sync(req.user.id);
  }

  /** Assinatura recorrente direto pelo cartão (Card Brick do Mercado Pago), sem sair do painel. */
  @Access()
  @AllowExpired()
  @UseGuards(RateLimitGuard)
  @RateLimit("billing-card", 10, 3600)
  @Post("subscribe-card")
  subscribeCard(@Request() req: any, @Body() dto: SubscribeCardDto) {
    return this.billing.subscribeWithCard(req.user.id, dto.plan, dto.token);
  }

  /** Gera o QR code do Pix para pagamento único. */
  @Access()
  @AllowExpired()
  @UseGuards(RateLimitGuard)
  @RateLimit("billing-pix", 10, 3600)
  @Post("pix")
  pix(@Request() req: any, @Body() dto: PixDto) {
    return this.billing.createPix(req.user.id, dto.plan);
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
    if (!ok) return { ok: false }; // 200 mesmo assim: não revela nada a quem não é o Mercado Pago
    await this.billing.handleNotification(type, dataId).catch(() => undefined);
    return { ok: true };
  }
}
