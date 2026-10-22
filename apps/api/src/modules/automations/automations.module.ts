import { Module } from "@nestjs/common";
import { AutomationsController } from "./automations.controller";
import { AutomationsService } from "./automations.service";
import { AutomationRunner } from "./automation-runner.service";

@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationRunner],
  exports: [AutomationsService, AutomationRunner],
})
export class AutomationsModule {}
