import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { jwtSecret } from "../../config/jwt-secret";
import { JwtModule } from "@nestjs/jwt";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { InboxGateway } from "./inbox.gateway";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({ secret: jwtSecret(config.get("JWT_SECRET")) }),
      inject: [ConfigService],
    }),
  ],
  controllers: [InboxController],
  providers: [InboxService, InboxGateway],
  exports: [InboxService, InboxGateway],
})
export class InboxModule {}
