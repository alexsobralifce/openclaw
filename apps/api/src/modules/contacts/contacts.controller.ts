import { Body, Controller, Get, Param, Patch, Post, Query, Request } from "@nestjs/common";
import { Access } from "../auth/access";
import { ContactsService } from "./contacts.service";

@Access("contacts")
@Controller("contacts")
export class ContactsController {
  constructor(private contacts: ContactsService) {}

  @Get()
  list(@Request() req: any, @Query("search") search?: string) {
    return this.contacts.list(req.user.workspaces[0]?.workspaceId, search);
  }

  @Get(":id")
  get(@Request() req: any, @Param("id") id: string) {
    return this.contacts.get(req.user.workspaces[0]?.workspaceId, id);
  }

  @Post()
  create(@Request() req: any, @Body() body: any) {
    return this.contacts.create(req.user.workspaces[0]?.workspaceId, body);
  }

  @Patch(":id")
  update(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.contacts.update(req.user.workspaces[0]?.workspaceId, id, body);
  }
}
