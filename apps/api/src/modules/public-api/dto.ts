import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class CreateApiKeyDto {
  @IsString() @Length(1, 80) name!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) scopes!: string[];
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(6000) rateLimit?: number;
}

export class ContactDto {
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateContactDto {
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpsertContactDto {
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateConversationDto {
  @IsIn(["OPEN", "PENDING", "RESOLVED", "SNOOZED"]) status!: string;
}

export class SendMessageDto {
  @IsString() @Length(8, 20) to!: string;
  @IsString() @Length(1, 4096) text!: string;
  @IsOptional() @IsString() channelId?: string;
}

export class CreateWebhookDto {
  @IsString() @Length(8, 2000) url!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
}

export class EmailListQuery {
  @IsOptional() @IsEmail() account?: string;
  @IsOptional() @IsString() @Length(0, 300) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25) limit?: number;
}

export class EmailAccountQuery {
  @IsOptional() @IsEmail() account?: string;
}

export class SendEmailDto {
  @IsEmail() to!: string;
  @IsString() @Length(1, 200) subject!: string;
  @IsString() @Length(1, 20000) text!: string;
  @IsOptional() @IsEmail() account?: string;
}

export class CalendarListQuery {
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
  @IsOptional() @IsEmail() account?: string;
}

export class CreateEventDto {
  @IsString() @Length(1, 200) title!: string;
  @IsISO8601() start!: string;
  @IsISO8601() end!: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) attendees?: string[];
  @IsOptional() @IsEmail() account?: string;
}

export class ListQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsISO8601() updatedSince?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() status?: string;
}
