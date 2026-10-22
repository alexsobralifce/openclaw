import { Module } from "@nestjs/common";
import { EvolutionModule } from "../channels/evolution/evolution.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [EvolutionModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
