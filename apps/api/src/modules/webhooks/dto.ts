import { IsArray, IsOptional, IsString, Length } from "class-validator";

export class CreateWebhookDto {
  @IsString() @Length(8, 2000) url!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
}
