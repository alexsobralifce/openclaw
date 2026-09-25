import { Module } from "@nestjs/common";
import { AutomationsController } from "./automations.controller";
import { AutomationsService } from "./automations.service";
import { AutomationRunner } from "./automation-runner.service";
import { EvolutionModule } from "../channels/evolution/evolution.module";
import { InboxModule } from "../inbox/inbox.module";

@Module({
  imports: [EvolutionModule, InboxModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationRunner],
  exports: [AutomationsService, AutomationRunner],
})
export class AutomationsModule {}
