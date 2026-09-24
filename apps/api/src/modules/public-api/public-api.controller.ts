import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "./api-key.guard";
import { PublicApiService } from "./public-api.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { ContactDto, CreateWebhookDto, ListQuery, SendMessageDto, UpdateContactDto, UpdateConversationDto, UpsertContactDto } from "./dto";
import { RequireScopes } from "./scopes";
import { PublicExceptionFilter } from "./public-exception.filter";

@Controller("api/public/v1")
@UseFilters(PublicExceptionFilter)
export class PublicApiController {
  constructor(
    private api: PublicApiService,
    private webhooks: WebhooksService,
  ) {}

  @Get("health")
  health() {
    return { status: "ok" };
  }

  @UseGuards(ApiKeyGuard)
  @Get("me")
  me(@Req() req: any) {
    return this.api.me(req.apiKey.workspaceId, req.apiKey.scopes);
  }

  // ─── Contatos ────────────────────────────────────────────────

  @UseGuards(ApiKeyGuard) @RequireScopes("contacts:read")
  @Get("contacts")
  listContacts(@Req() req: any, @Query() q: ListQuery) {
    return this.api.listContacts(req.apiKey.workspaceId, q);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("contacts:write")
  @Post("contacts")
  createContact(@Req() req: any, @Body() body: ContactDto) {
    return this.api.createContact(req.apiKey.workspaceId, body);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("contacts:write")
  @Put("contacts/by-phone/:phone")
  upsertContact(@Req() req: any, @Param("phone") phone: string, @Body() body: UpsertContactDto) {
    return this.api.upsertContactByPhone(req.apiKey.workspaceId, phone, body);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("contacts:read")
  @Get("contacts/:id")
  getContact(@Req() req: any, @Param("id") id: string) {
    return this.api.getContact(req.apiKey.workspaceId, id);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("contacts:write")
  @Patch("contacts/:id")
  updateContact(@Req() req: any, @Param("id") id: string, @Body() body: UpdateContactDto) {
    return this.api.updateContact(req.apiKey.workspaceId, id, body);
  }

  // ─── Conversas e mensagens ───────────────────────────────────

  @UseGuards(ApiKeyGuard) @RequireScopes("conversations:read")
  @Get("conversations")
  listConversations(@Req() req: any, @Query() q: ListQuery) {
    return this.api.listConversations(req.apiKey.workspaceId, q);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("conversations:read")
  @Get("conversations/:id")
  getConversation(@Req() req: any, @Param("id") id: string) {
    return this.api.getConversation(req.apiKey.workspaceId, id);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("conversations:write")
  @Patch("conversations/:id")
  updateConversation(@Req() req: any, @Param("id") id: string, @Body() body: UpdateConversationDto) {
    return this.api.updateConversation(req.apiKey.workspaceId, id, body.status);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("messages:read")
  @Get("conversations/:id/messages")
  listMessages(@Req() req: any, @Param("id") id: string, @Query() q: ListQuery) {
    return this.api.listMessages(req.apiKey.workspaceId, id, q);
  }

  // ─── Webhooks de saída ───────────────────────────────────────

  @UseGuards(ApiKeyGuard) @RequireScopes("webhooks:manage")
  @Get("webhooks")
  listWebhooks(@Req() req: any) {
    return this.webhooks.list(req.apiKey.workspaceId).then((data) => ({ data }));
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("webhooks:manage")
  @Post("webhooks")
  createWebhook(@Req() req: any, @Body() body: CreateWebhookDto) {
    return this.webhooks.create(req.apiKey.workspaceId, body);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("webhooks:manage")
  @Delete("webhooks/:id")
  deleteWebhook(@Req() req: any, @Param("id") id: string) {
    return this.webhooks.remove(req.apiKey.workspaceId, id);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("webhooks:manage")
  @Post("webhooks/:id/test")
  testWebhook(@Req() req: any, @Param("id") id: string) {
    return this.webhooks.test(req.apiKey.workspaceId, id);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("webhooks:manage")
  @Get("webhooks/:id/deliveries")
  webhookDeliveries(@Req() req: any, @Param("id") id: string) {
    return this.webhooks.deliveries(req.apiKey.workspaceId, id);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("webhooks:manage")
  @Post("webhooks/:id/deliveries/:deliveryId/retry")
  retryDelivery(@Req() req: any, @Param("id") id: string, @Param("deliveryId") deliveryId: string) {
    return this.webhooks.retry(req.apiKey.workspaceId, id, deliveryId);
  }

  @UseGuards(ApiKeyGuard) @RequireScopes("messages:send")
  @Post("messages")
  send(@Req() req: any, @Body() body: SendMessageDto) {
    return this.api.sendMessage(req.apiKey.workspaceId, body);
  }
}
