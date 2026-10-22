import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { SESSION_DAYS } from "./session-cookie";
import { SessionRenewInterceptor } from "./session-renew.interceptor";
import { jwtSecret } from "../../config/jwt-secret";
import { MailService } from "./mail.service";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config.get("JWT_SECRET")),
        signOptions: { expiresIn: `${SESSION_DAYS}d` },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MailService, JwtStrategy, { provide: APP_INTERCEPTOR, useClass: SessionRenewInterceptor }],
  exports: [AuthService, MailService],
})
export class AuthModule {}
