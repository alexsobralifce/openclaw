import { Body, Controller, ForbiddenException, Get, Patch, Request } from "@nestjs/common";
import { prisma } from "@magobox/database";
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
  async update(@Request() req: any, @Body() body: any) {
    const workspaceId: string = req.user.workspaces[0]?.workspaceId;
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: req.user.id, role: { in: ["OWNER", "ADMIN"] } },
    });
    if (!member) throw new ForbiddenException("Somente dono ou administrador podem alterar o workspace");
    return this.ws.updateWorkspace(workspaceId, body);
  }
}
