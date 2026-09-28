import { Module } from "@nestjs/common";
import { GoogleModule } from "../integrations/google/google.module";
import { VaultController } from "./vault.controller";
import { VaultService } from "./vault.service";

@Module({ imports: [GoogleModule], controllers: [VaultController], providers: [VaultService], exports: [VaultService] })
export class VaultModule {}
