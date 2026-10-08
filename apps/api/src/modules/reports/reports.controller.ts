import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, Request } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Access, AdminOnly } from "../auth/access";
import { REPORT_STATUSES, ReportsService } from "./reports.service";

class CreateReportDto {
  @IsString() @MinLength(5, { message: "Descreva o problema com pelo menos 5 letras." }) @MaxLength(2000) message!: string;
  @IsOptional() @IsString() @MaxLength(200) page?: string;
}

class SetStatusDto {
  @IsIn(REPORT_STATUSES as unknown as string[]) status!: string;
}

@Controller("bug-reports")
export class ReportsController {
  constructor(private reports: ReportsService) {}

  /** Qualquer usuário logado pode relatar um problema. */
  @Access()
  @Post()
  create(@Request() req: any, @Body() dto: CreateReportDto, @Headers("user-agent") ua?: string) {
    if (!dto.message?.trim()) throw new BadRequestException("Descreva o problema.");
    return this.reports.create(req.user.id, { message: dto.message, page: dto.page, userAgent: ua });
  }

  @AdminOnly()
  @Get()
  list(@Query("status") status?: string) {
    return this.reports.list(status);
  }

  @AdminOnly()
  @Patch(":id")
  setStatus(@Param("id") id: string, @Body() dto: SetStatusDto) {
    return this.reports.setStatus(id, dto.status);
  }
}
