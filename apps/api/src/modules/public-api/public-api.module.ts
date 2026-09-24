import { Module } from "@nestjs/common";
import { ChannelsModule } from "../channels/channels.module";
import { InboxModule } from "../inbox/inbox.module";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyGuard } from "./api-key.guard";
import { PublicApiController } from "./public-api.controller";
import { PublicApiService } from "./public-api.service";

@Module({
  imports: [ChannelsModule, InboxModule],
  controllers: [ApiKeysController, PublicApiController],
  providers: [ApiKeysService, ApiKeyGuard, PublicApiService],
})
export class PublicApiModule {}
