import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { GoogleController } from "./google.controller";
import { GoogleService } from "./google.service";
import { jwtSecret } from "../../../config/jwt-secret";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({ secret: jwtSecret(config.get("JWT_SECRET")) }),
      inject: [ConfigService],
    }),
  ],
  controllers: [GoogleController],
  providers: [GoogleService],
  exports: [GoogleService],
})
export class GoogleModule {}
