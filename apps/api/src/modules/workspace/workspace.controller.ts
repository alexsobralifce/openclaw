import { Body, Controller, Get, Patch, Request } from "@nestjs/common";
import { Access } from "../auth/access";
import { WorkspaceService } from "./workspace.service";

@Access()
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
