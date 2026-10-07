import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { jwtSecret } from "../../../config/jwt-secret";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthModule } from "../../auth/auth.module";
import { GoogleController } from "./google.controller";
import { GoogleService } from "./google.service";

@Module({
  imports: [
    AuthModule,
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
