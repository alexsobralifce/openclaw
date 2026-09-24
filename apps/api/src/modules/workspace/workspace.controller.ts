import { Body, Controller, Get, Patch, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { WorkspaceService } from "./workspace.service";

@UseGuards(AuthGuard("jwt"))
@Controller("workspace")
export class WorkspaceController {
  constructor(private ws: WorkspaceService) {}

  @Get()
  get(@Request() req: any) {
    return this.ws.getWorkspace(req.user.workspaces[0]?.workspaceId);
  }

  @Patch()
  update(@Request() req: any, @Body() body: any) {
    return this.ws.updateWorkspace(req.user.workspaces[0]?.workspaceId, body);
  }
}
