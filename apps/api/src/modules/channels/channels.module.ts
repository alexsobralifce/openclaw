import { Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { EvolutionService } from "./evolution/evolution.service";
import { WhatsappWorker } from "./workers/whatsapp.worker";
import { AssistantService } from "./assistant/assistant.service";
import { MenuService } from "./assistant/menu.service";
import { MemoryService } from "./assistant/memory.service";
import { GeminiService } from "./assistant/gemini.service";
import { EmailWatcherService } from "./assistant/email-watcher.service";
import { GoogleModule } from "../integrations/google/google.module";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  imports: [InboxModule, GoogleModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, EvolutionService, WhatsappWorker, AssistantService, MenuService, MemoryService, GeminiService, EmailWatcherService],
  exports: [ChannelsService, EvolutionService],
})
export class ChannelsModule {}
