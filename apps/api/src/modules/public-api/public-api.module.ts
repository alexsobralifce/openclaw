import { Module } from "@nestjs/common";
import { GoogleModule } from "../integrations/google/google.module";
import { GooglePublicService } from "./google-public.service";
import { ChannelsModule } from "../channels/channels.module";
import { InboxModule } from "../inbox/inbox.module";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyGuard } from "./api-key.guard";
import { PublicApiController } from "./public-api.controller";
import { PublicApiService } from "./public-api.service";

@Module({
  imports: [ChannelsModule, InboxModule, GoogleModule],
  controllers: [ApiKeysController, PublicApiController],
  providers: [ApiKeysService, ApiKeyGuard, PublicApiService, GooglePublicService],
})
export class PublicApiModule {}
