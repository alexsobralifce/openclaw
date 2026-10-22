import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { InboxGateway } from "./inbox.gateway";
import { EncryptionBackfillService } from "./encryption-backfill.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({ secret: jwtSecret(config.get("JWT_SECRET")) }),
      inject: [ConfigService],
    }),
  ],
  controllers: [InboxController],
  providers: [InboxService, InboxGateway, EncryptionBackfillService],
  exports: [InboxService, InboxGateway],
})
export class InboxModule {}
