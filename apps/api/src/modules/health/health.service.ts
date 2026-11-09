import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { EvolutionService } from "../channels/evolution/evolution.service";

const CHECK_TIMEOUT_MS = 5_000;
const CACHE_MS = 30_000;
// Mensagem recebida que segue sem ser processada por mais que isto é sinal de problema

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  failing: string[];
}

const withTimeout = <T>(p: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private cache?: { at: number; report: HealthReport };

  constructor(private evolution: EvolutionService) {}

  /** Só o banco: usado pelo healthcheck do Railway (não pode depender de serviços externos). */
  async live(): Promise<HealthReport> {
    return (await this.db()) ? { status: "ok", failing: [] } : { status: "down", failing: ["db"] };
  }

  /**
   * Verificação completa para o monitor externo: banco e WhatsApp do root.
   * Resultado guardado por 30 s para que o endpoint público não vire uma forma de sobrecarregar os serviços.
   */
  async full(): Promise<HealthReport> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.report;
    const failing: string[] = [];

    if (!(await this.db())) failing.push("db");
    else {
      failing.push(...(await this.whatsapp()));
    }

    const report: HealthReport = { status: failing.includes("db") ? "down" : failing.length ? "degraded" : "ok", failing };
    this.cache = { at: Date.now(), report };
    return report;
  }

  private async db() {
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 3_000);
      return true;
    } catch (e: any) {
      this.logger.error(`Banco indisponível: ${e.message}`);
      return false;
    }
  }

  /** WhatsApp conectado nos workspaces do root (o teste de outros usuários não deve gerar alarme). */
  private async whatsapp(): Promise<string[]> {
    try {
      const owners = await prisma.workspaceMember.findMany({ where: { role: "OWNER", user: { role: "ROOT" } }, select: { workspaceId: true } });
      const channels = await prisma.channel.findMany({
        where: { workspaceId: { in: owners.map((o) => o.workspaceId) }, type: "WHATSAPP", isActive: true },
      });
      const failing = new Set<string>();
      for (const ch of channels) {
        try {
          const r: any = await withTimeout(this.evolution.getConnectionState((ch.config as any)?.instanceName));
          if ((r?.instance?.state ?? r?.state) !== "open") failing.add("whatsapp-desconectado");
        } catch {
          failing.add("evolution");
        }
      }
      return [...failing];
    } catch {
      return [];
    }
  }
}
