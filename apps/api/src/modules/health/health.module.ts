import { Module } from "@nestjs/common";
import { EvolutionModule } from "../channels/evolution/evolution.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({ imports: [EvolutionModule], controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
