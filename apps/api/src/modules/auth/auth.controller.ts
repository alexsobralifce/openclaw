import { Body, Controller, Get, HttpCode, Patch, Post, Request, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { Access } from "./access";
import { RateLimit, RateLimitGuard } from "./rate-limit";
import { SERVICES } from "./permissions";
import { clearSessionCookie, setSessionCookie } from "./session-cookie";

const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim().toLowerCase() : value);

class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  workspaceName!: string;
}

class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;
}

class TokenDto {
  @IsString()
  @MaxLength(200)
  token!: string;
}

class ResetDto extends TokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class GoogleTicketDto {
  @IsString() @Matches(/^[a-f0-9]{48}$/)
  ticket!: string;
}

class ProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  // Vazio remove o número; senão, DDI + DDD + número (ex.: 5585912345678)
  @IsOptional() @IsString() @Matches(/^(\+?[\d\s()-]{10,20})?$/, { message: "WhatsApp inválido: use DDI + DDD + número" })
  phone?: string;
}

/** Grava o cookie da sessão quando a resposta traz um token (cadastro pendente de aprovação não traz). */
function startSession<T extends object>(res: Response, result: T): T {
  const token = (result as { accessToken?: string }).accessToken;
  if (token) setSessionCookie(res, token);
  return result;
}

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit("register", 5, 3600)
  @Post("register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return startSession(res, await this.auth.register(dto.email, dto.name, dto.password, dto.workspaceName));
  }

  @UseGuards(RateLimitGuard)
  @RateLimit("forgot", 5, 3600)
  @HttpCode(200)
  @Post("forgot")
  forgot(@Body() dto: EmailDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit("reset", 10, 900)
  @HttpCode(200)
  @Post("reset")
  reset(@Body() dto: ResetDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit("verify-email", 20, 900)
  @HttpCode(200)
  @Post("verify-email")
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit("login", 20, 900)
  @Post("login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return startSession(res, await this.auth.login(dto.email, dto.password));
  }

  @UseGuards(RateLimitGuard)
  @RateLimit("google-exchange", 30, 900)
  @Post("google/exchange")
  async googleExchange(@Body() dto: GoogleTicketDto, @Res({ passthrough: true }) res: Response) {
    return startSession(res, await this.auth.loginWithGoogleTicket(dto.ticket));
  }

  /** Encerra a sessão do painel: o cookie é HttpOnly, só o servidor consegue apagá-lo. */
  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
  }

  @Access()
  @Get("me")
  me(@Request() req: any) {
    return this.auth.me(req.user.id);
  }

  /** Nomes amigáveis dos serviços (para o painel mostrar o que está liberado). */
  @Access()
  @Get("services")
  services() {
    return SERVICES;
  }

  @Access()
  @Patch("me")
  updateMe(@Request() req: any, @Body() dto: ProfileDto) {
    return this.auth.updateProfile(req.user.id, dto);
  }
}
