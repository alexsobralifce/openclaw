import { Body, Controller, Delete, Get, Param, Patch, Post, Request } from "@nestjs/common";
import { IsBoolean, IsDefined, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Access } from "../auth/access";
import { AutomationsService } from "./automations.service";

// trigger/actions são validados em rules.ts (estrutura com variantes por tipo)
class CreateAutomationDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsDefined() trigger!: unknown;
  @IsDefined() actions!: unknown;
}

class UpdateAutomationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() trigger?: unknown;
  @IsOptional() actions?: unknown;
}

class ToggleDto {
  @IsBoolean() isActive!: boolean;
}

@Access("automations")
@Controller("automations")
export class AutomationsController {
  constructor(private automations: AutomationsService) {}

  @Get()
  list(@Request() req: any) {
    return this.automations.list(req.user.workspaces[0]?.workspaceId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateAutomationDto) {
    return this.automations.create(req.user.workspaces[0]?.workspaceId, body.name, body.trigger, body.actions);
  }

  @Patch(":id")
  update(@Request() req: any, @Param("id") id: string, @Body() body: UpdateAutomationDto) {
    return this.automations.update(req.user.workspaces[0]?.workspaceId, id, body);
  }

  @Patch(":id/toggle")
  toggle(@Request() req: any, @Param("id") id: string, @Body() body: ToggleDto) {
    return this.automations.toggle(req.user.workspaces[0]?.workspaceId, id, body.isActive);
  }

  @Delete(":id")
  remove(@Request() req: any, @Param("id") id: string) {
    return this.automations.remove(req.user.workspaces[0]?.workspaceId, id);
  }
}
