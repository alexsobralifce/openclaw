import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { WhatsappWorker } from "./workers/whatsapp.worker";
import { AssistantSchedulerService } from "./assistant/assistant-scheduler.service";
import { WeatherService } from "./assistant/weather.service";
import { AssistantService } from "./assistant/assistant.service";
import { MenuService } from "./assistant/menu.service";
import { AssistantSettingsController } from "./assistant/assistant-settings.controller";
import { MemoryService } from "./assistant/memory.service";
import { GeminiService } from "./assistant/gemini.service";
import { IntentService } from "./assistant/intent.service";
import { EmailWatcherService } from "./assistant/email-watcher.service";
import { GoogleModule } from "../integrations/google/google.module";
import { InboxModule } from "../inbox/inbox.module";
import { EvolutionModule } from "./evolution/evolution.module";
import { AutomationsModule } from "../automations/automations.module";
import { VaultModule } from "../vault/vault.module";
import { InboundService } from "./inbound/inbound.service";
import { InstagramService } from "./instagram/instagram.service";
import { TelegramService } from "./telegram/telegram.service";
import { TelegramController } from "./telegram/telegram.controller";
import { SpotifyController } from "./spotify/spotify.controller";
import { SpotifyService } from "./spotify/spotify.service";
import { DocumentsController } from "./documents.controller";
import { AppChatController } from "./app-chat/app-chat.controller";
import { AppChatService } from "./app-chat/app-chat.service";
import { AppChatGateway } from "./app-chat/app-chat.gateway";
import { PushService } from "./app-chat/push.service";
import { InstagramWorker } from "./workers/instagram.worker";
import { jwtSecret } from "../../config/jwt-secret";

@Module({
  imports: [
    InboxModule, GoogleModule, EvolutionModule, AutomationsModule, VaultModule,
    // Assina o `state` do OAuth do Instagram (mesmo esquema do Google)
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({ secret: jwtSecret(config.get("JWT_SECRET")) }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ChannelsController, AssistantSettingsController, TelegramController, AppChatController, DocumentsController, SpotifyController],
  providers: [SpotifyService, TelegramService, AppChatService, AppChatGateway, PushService, ChannelsService, WhatsappWorker, InstagramWorker, InstagramService, InboundService, AssistantService, MenuService, MemoryService, GeminiService, IntentService, EmailWatcherService, WeatherService, AssistantSchedulerService],
  exports: [ChannelsService, EvolutionModule, AssistantService],
})
export class ChannelsModule {}
