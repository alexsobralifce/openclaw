import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { InboxGateway } from "./inbox.gateway";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({ secret: config.get("JWT_SECRET") || "change-me-in-production" }),
      inject: [ConfigService],
    }),
  ],
  controllers: [InboxController],
  providers: [InboxService, InboxGateway],
  exports: [InboxService, InboxGateway],
})
export class InboxModule {}
