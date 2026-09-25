import { Body, Controller, Get, Patch, Post, Request, UseGuards } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { Access } from "./access";
import { RateLimit, RateLimitGuard } from "./rate-limit";
import { SERVICES } from "./permissions";

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

class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class ProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  // Vazio remove o número; senão, DDI + DDD + número (ex.: 5585912345678)
  @IsOptional() @IsString() @Matches(/^(\+?[\d\s()-]{10,20})?$/, { message: "WhatsApp inválido: use DDI + DDD + número" })
  phone?: string;
}

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit("register", 5, 3600)
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.name, dto.password, dto.workspaceName);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit("login", 20, 900)
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
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
