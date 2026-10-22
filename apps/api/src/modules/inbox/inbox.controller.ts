import { Body, Controller, Delete, Get, Param, Patch, Query, Request } from "@nestjs/common";
import { Access } from "../auth/access";
import { InboxService } from "./inbox.service";

@Access("inbox")
@Controller("inbox")
export class InboxController {
  constructor(private inbox: InboxService) {}

  @Get("conversations")
  list(@Request() req: any, @Query("status") status?: string) {
    const workspaceId = req.user.workspaces[0]?.workspaceId;
    return this.inbox.listConversations(workspaceId, status);
  }

  @Get("conversations/:id")
  get(@Request() req: any, @Param("id") id: string) {
    const workspaceId = req.user.workspaces[0]?.workspaceId;
    return this.inbox.getConversation(workspaceId, id);
  }

  @Patch("conversations/:id/status")
  updateStatus(@Request() req: any, @Param("id") id: string, @Body() body: { status: string }) {
    const workspaceId = req.user.workspaces[0]?.workspaceId;
    return this.inbox.updateStatus(workspaceId, id, body.status);
  }

  /** `deleteContact=true` apaga também o contato, se não sobrar outra conversa dele. */
  @Delete("conversations/:id")
  remove(@Request() req: any, @Param("id") id: string, @Query("deleteContact") deleteContact?: string) {
    const workspaceId = req.user.workspaces[0]?.workspaceId;
    return this.inbox.deleteConversation(workspaceId, id, deleteContact === "true");
  }
}
