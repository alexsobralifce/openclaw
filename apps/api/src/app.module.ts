import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { WorkspaceModule } from "./modules/workspace/workspace.module";
import { InboxModule } from "./modules/inbox/inbox.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { ChannelsModule } from "./modules/channels/channels.module";
import { GoogleModule } from "./modules/integrations/google/google.module";
import { PublicApiModule } from "./modules/public-api/public-api.module";
import { AutomationsModule } from "./modules/automations/automations.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    WorkspaceModule,
    InboxModule,
    ContactsModule,
    ChannelsModule,
    AutomationsModule,
    GoogleModule,
    PublicApiModule,
  ],
})
export class AppModule {}
