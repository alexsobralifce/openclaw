import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { WebhooksService, WEBHOOK_EVENTS } from "./webhooks.service";
import { CreateWebhookDto } from "../public-api/dto";

/** Gestão dos webhooks pelo painel (JWT). A API pública usa o mesmo serviço. */
@UseGuards(AuthGuard("jwt"))
@Controller("webhooks")
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  private ws = (req: any): string => req.user.workspaces[0]?.workspaceId;

  @Get("events")
  events() {
    return WEBHOOK_EVENTS.filter((e) => e !== "webhook.test");
  }

  @Get()
  list(@Request() req: any) {
    return this.webhooks.list(this.ws(req));
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateWebhookDto) {
    return this.webhooks.create(this.ws(req), body);
  }

  @Delete(":id")
  remove(@Request() req: any, @Param("id") id: string) {
    return this.webhooks.remove(this.ws(req), id);
  }

  @Post(":id/test")
  test(@Request() req: any, @Param("id") id: string) {
    return this.webhooks.test(this.ws(req), id);
  }

  @Get(":id/deliveries")
  deliveries(@Request() req: any, @Param("id") id: string) {
    return this.webhooks.deliveries(this.ws(req), id);
  }

  @Post(":id/deliveries/:deliveryId/retry")
  retry(@Request() req: any, @Param("id") id: string, @Param("deliveryId") deliveryId: string) {
    return this.webhooks.retry(this.ws(req), id, deliveryId);
  }
}
