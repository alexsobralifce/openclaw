import { Body, Controller, Get, Param, Patch, Post, Request } from "@nestjs/common";
import { Access } from "../auth/access";
import { AutomationsService } from "./automations.service";

@Access("automations")
@Controller("automations")
export class AutomationsController {
  constructor(private automations: AutomationsService) {}

  @Get()
  list(@Request() req: any) {
    return this.automations.list(req.user.workspaces[0]?.workspaceId);
  }

  @Post()
  create(@Request() req: any, @Body() body: any) {
    return this.automations.create(req.user.workspaces[0]?.workspaceId, body.name, body.trigger, body.actions);
  }

  @Patch(":id/toggle")
  toggle(@Request() req: any, @Param("id") id: string, @Body("isActive") isActive: boolean) {
    return this.automations.toggle(req.user.workspaces[0]?.workspaceId, id, isActive);
  }
}
