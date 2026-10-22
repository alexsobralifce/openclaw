import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { WorkspaceModule } from "./modules/workspace/workspace.module";
import { InboxModule } from "./modules/inbox/inbox.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { ChannelsModule } from "./modules/channels/channels.module";
import { GoogleModule } from "./modules/integrations/google/google.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { PublicApiModule } from "./modules/public-api/public-api.module";
import { AutomationsModule } from "./modules/automations/automations.module";
import { StateModule } from "./modules/state/state.module";
import { UsersModule } from "./modules/users/users.module";
import { UsageModule } from "./modules/usage/usage.module";
import { VaultModule } from "./modules/vault/vault.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StateModule,
    UsersModule,
    UsageModule,
    HealthModule,
    AuthModule,
    WorkspaceModule,
    InboxModule,
    ContactsModule,
    ChannelsModule,
    AutomationsModule,
    GoogleModule,
    WebhooksModule,
    PublicApiModule,
    VaultModule,
    ReportsModule,
  ],
})
export class AppModule {}
