import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { AdminOnly } from "../auth/access";
import { PlatformRole, SERVICES, UserStatus } from "../auth/permissions";
import { UsersService } from "./users.service";

const ROLES: PlatformRole[] = ["ROOT", "ADMIN", "USER"];
const STATUSES: UserStatus[] = ["PENDING", "ACTIVE", "DISABLED"];
const PHONE = /^(\+?[\d\s()-]{10,20})?$/;

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() @MaxLength(80) workspaceName?: string;
  @IsOptional() @IsIn(ROLES) role?: PlatformRole;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) services?: string[];
  @IsOptional() @IsString() @Matches(PHONE, { message: "WhatsApp inválido" }) phone?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @Matches(PHONE, { message: "WhatsApp inválido" }) phone?: string;
  @IsOptional() @IsIn(ROLES) role?: PlatformRole;
  @IsOptional() @IsIn(STATUSES) status?: UserStatus;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) services?: string[];
}

@AdminOnly()
@Controller("users")
export class UsersController {
  constructor(private users: UsersService) {}

  @Get("services")
  services() {
    return { services: SERVICES, ...this.users.catalog() };
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.users.list(STATUSES.includes(status as UserStatus) ? status : undefined);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateUserDto) {
    return this.users.create(req.user.role, dto);
  }

  @Patch(":id")
  update(@Request() req: any, @Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(req.user.id, req.user.role, id, dto);
  }

  @Delete(":id")
  remove(@Request() req: any, @Param("id") id: string) {
    return this.users.remove(req.user.id, req.user.role, id);
  }
}
