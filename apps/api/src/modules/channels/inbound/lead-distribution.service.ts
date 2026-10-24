import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { EvolutionService } from "../evolution/evolution.service";
import { samePhone } from "../whatsapp/phone";

export type Seller = { name: string; phone: string };
export type Distribution = { enabled: boolean; sellers: Seller[]; cursor: number };

/** Lê `config.distribution` do canal, tolerando configuração ausente ou malformada. */
export function readDistribution(config: any): Distribution {
  const d = config?.distribution ?? {};
  return {
    enabled: d.enabled === true,
    sellers: Array.isArray(d.sellers) ? d.sellers.filter((s: any) => s?.phone) : [],
    cursor: Number.isInteger(d.cursor) && d.cursor >= 0 ? d.cursor : 0,
  };
}

@Injectable()
export class LeadDistributionService {
  private readonly logger = new Logger(LeadDistributionService.name);

  constructor(private evolution: EvolutionService) {}

  /**
   * Entrega a mensagem de um cliente a um vendedor, em rodízio. Cliente já atribuído continua com o mesmo vendedor.
   * Nunca lança: falha de envio faz rollback (o cliente não fica atribuído) e a mensagem continua no inbox.
   */
  async distribute(
    channel: { id: string; workspaceId: string; config: any },
    res: { contact: { name: string; phone: string | null }; message: { body: string } },
  ) {
    const contactPhone = res.contact.phone;
    const instance = channel.config?.instanceName;
    if (!contactPhone || !instance) return;
    if (!readDistribution(channel.config).enabled) return;

    try {
      await prisma.$transaction(
        async (tx) => {
          // Trava a linha do canal: duas mensagens simultâneas não recebem o mesmo vendedor
          await tx.$queryRaw`SELECT id FROM "Channel" WHERE id = ${channel.id} FOR UPDATE`;
          const fresh = await tx.channel.findUnique({ where: { id: channel.id }, select: { config: true } });
          const cfg: any = fresh?.config ?? {};
          const cur = readDistribution(cfg);
          if (!cur.enabled || cur.sellers.length === 0) return;
          // Mensagem enviada por um vendedor não é de cliente
          if (cur.sellers.some((s) => samePhone(s.phone, contactPhone))) return;

          const prev = await tx.leadAssignment.findFirst({
            where: { workspaceId: channel.workspaceId, channelId: channel.id, contactPhone },
            orderBy: { createdAt: "desc" },
          });
          const kept = prev ? cur.sellers.find((s) => samePhone(s.phone, prev.sellerPhone)) : undefined;
          const seller = kept ?? cur.sellers[cur.cursor % cur.sellers.length];

          const text = [
            "📩 *Novo contato para atender*",
            `Nome: ${res.contact.name || "sem nome"}`,
            `Telefone: ${contactPhone}`,
            `Conversa: https://wa.me/${contactPhone}`,
            "",
            `Mensagem: ${res.message.body}`,
          ].join("\n");
          // Se o envio falhar, lança e o rollback desfaz tudo (cursor e atribuição)
          await this.evolution.sendText(instance, seller.phone, text);

          if (!kept) {
            await tx.leadAssignment.create({
              data: { workspaceId: channel.workspaceId, channelId: channel.id, contactPhone, sellerPhone: seller.phone },
            });
            await tx.channel.update({
              where: { id: channel.id },
              data: { config: { ...cfg, distribution: { ...(cfg.distribution ?? {}), cursor: cur.cursor + 1 } } },
            });
          }
        },
        { timeout: 20_000 },
      );
    } catch (e: any) {
      this.logger.error(`Distribuição de lead falhou (canal ${channel.id}): ${e?.message ?? e}`);
    }
  }
}
