import { Body, Controller, Headers, HttpCode, Post, Query, Request, UseGuards } from "@nestjs/common";
import { IsIn, IsString } from "class-validator";
import { Access, AllowExpired } from "../auth/access";
import { PLAN_IDS } from "../auth/plans";
import { RateLimit, RateLimitGuard } from "../auth/rate-limit";
import { BillingService } from "./billing.service";
import { verifyMpSignature } from "./mp-utils";

class CheckoutDto {
  @IsString() @IsIn(PLAN_IDS) plan!: string;
  @IsIn(["card", "pix"]) method!: "card" | "pix";
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
