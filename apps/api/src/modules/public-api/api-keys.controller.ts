import { Body, Controller, Delete, Get, Param, Post, Request } from "@nestjs/common";
import { Access } from "../auth/access";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto";
import { SCOPES } from "./scopes";

/** Gestão das chaves pelo painel (autenticado por JWT). */
@Access("api")
@Controller("api-keys")
export class ApiKeysController {
  constructor(private keys: ApiKeysService) {}

  @Get("scopes")
  scopes() {
    return SCOPES;
  }

  @Get()
  list(@Request() req: any) {
    return this.keys.list(req.user.workspaces[0]?.workspaceId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateApiKeyDto) {
    return this.keys.create(req.user.workspaces[0]?.workspaceId, body);
  }

  @Delete(":id")
  revoke(@Request() req: any, @Param("id") id: string) {
    return this.keys.revoke(req.user.workspaces[0]?.workspaceId, id);
  }
}
