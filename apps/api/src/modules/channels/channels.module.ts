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
import { MemoryService } from "./assistant/memory.service";
import { GeminiService } from "./assistant/gemini.service";
import { EmailWatcherService } from "./assistant/email-watcher.service";
import { GoogleModule } from "../integrations/google/google.module";
import { VaultModule } from "../vault/vault.module";
import { InboxModule } from "../inbox/inbox.module";
import { EvolutionModule } from "./evolution/evolution.module";
import { AutomationsModule } from "../automations/automations.module";
import { InboundService } from "./inbound/inbound.service";
import { InstagramService } from "./instagram/instagram.service";
import { InstagramWorker } from "./workers/instagram.worker";

@Module({
  imports: [
    InboxModule, GoogleModule, VaultModule, EvolutionModule, AutomationsModule,
    // Assina o `state` do OAuth do Instagram (mesmo esquema do Google)
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({ secret: config.get("JWT_SECRET") || "change-me-in-production" }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ChannelsController],
  providers: [ChannelsService, WhatsappWorker, InstagramWorker, InstagramService, InboundService, AssistantService, MenuService, MemoryService, GeminiService, EmailWatcherService, WeatherService, AssistantSchedulerService],
  exports: [ChannelsService, EvolutionModule],
})
export class ChannelsModule {}
