import { Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { WhatsappWorker } from "./workers/whatsapp.worker";
import { AssistantService } from "./assistant/assistant.service";
import { MenuService } from "./assistant/menu.service";
import { MemoryService } from "./assistant/memory.service";
import { GeminiService } from "./assistant/gemini.service";
import { EmailWatcherService } from "./assistant/email-watcher.service";
import { GoogleModule } from "../integrations/google/google.module";
import { InboxModule } from "../inbox/inbox.module";
import { EvolutionModule } from "./evolution/evolution.module";
import { AutomationsModule } from "../automations/automations.module";
import { InboundService } from "./inbound/inbound.service";

@Module({
  imports: [InboxModule, GoogleModule, EvolutionModule, AutomationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, WhatsappWorker, InboundService, AssistantService, MenuService, MemoryService, GeminiService, EmailWatcherService],
  exports: [ChannelsService, EvolutionModule],
})
export class ChannelsModule {}
