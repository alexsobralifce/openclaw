import { Injectable, Logger } from "@nestjs/common";

/** Falha ao falar com o Evolution. `status` é null quando nem chegou a ele (fora do ar, rede). */
export class EvolutionError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
  get unreachable() { return this.status === null; }
  /** O Evolution não conhece a instância: ela se perdeu (ex.: ele reiniciou sem volume). */
  get missingInstance() { return this.status === 404; }
}

/** Texto para o usuário final, sem detalhes técnicos. */
export function evolutionMessage(e: unknown): string {
  if (!(e instanceof EvolutionError)) return "Não foi possível falar com o serviço de WhatsApp.";
  if (e.unreachable) return "O serviço de WhatsApp está fora do ar. Tente de novo em instantes.";
  if (e.missingInstance || /connection closed|not connected/i.test(e.message)) {
    return "O WhatsApp está desconectado. Reconecte o canal em Canais (Ver QR Code).";
  }
  if (e.status === 401 || e.status === 403) return "O serviço de WhatsApp recusou o acesso. Avise o administrador.";
  return "O serviço de WhatsApp recusou a operação. Tente de novo; se persistir, reconecte o canal.";
}

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly base = process.env.EVOLUTION_API_URL || "http://localhost:8080";
  private readonly apiKey = process.env.EVOLUTION_API_KEY || "";

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        // Sem prazo, um Evolution travado seguraria a requisição (e a fila de entrada) para sempre
        signal: init?.signal ?? AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
          ...(init?.headers ?? {}),
        },
      });
    } catch (e: any) {
      throw new EvolutionError(`Evolution API inacessível: ${e?.cause?.code ?? e?.name ?? e?.message}`, null);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new EvolutionError(`Evolution API ${res.status}: ${body}`, res.status);
    }
    return res.json() as Promise<T>;
  }

  /** O Evolution respondeu 404: a instância não existe mais nele (ex.: ele foi reiniciado sem volume). */
  isMissingInstance(e: unknown) {
    return e instanceof EvolutionError && e.missingInstance;
  }

  async createInstance(instanceName: string, webhookUrl: string) {
    const instance = await this.req<any>("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });

    // Configurar webhook separadamente (v2)
    if (webhookUrl) {
      await this.req<any>(`/webhook/set/${instanceName}`, {
        method: "POST",
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl,
            byEvents: false,
            ...(process.env.WEBHOOK_SECRET ? { headers: { "x-openclaw-secret": process.env.WEBHOOK_SECRET } } : {}),
            base64: false,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
          },
        }),
      }).catch((e) => this.logger.error(`Falha ao configurar webhook: ${e.message}`));
    }

    return instance;
  }

  async getQrCode(instanceName: string): Promise<{ code: string; base64: string }> {
    return this.req<any>(`/instance/connect/${instanceName}`);
  }

  async getConnectionState(instanceName: string): Promise<{ state: string }> {
    return this.req<any>(`/instance/connectionState/${instanceName}`);
  }

  async getMediaBase64(instanceName: string, key: object): Promise<{ base64: string; mimetype?: string }> {
    return this.req<any>(`/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ message: { key }, convertToMp4: false }),
    });
  }

  async deleteInstance(instanceName: string) {
    return this.req<any>(`/instance/delete/${instanceName}`, { method: "DELETE" });
  }

  async sendText(instanceName: string, to: string, text: string) {
    // to = número com DDI, ex: "5585912345678"
    return this.req<any>(`/message/sendText/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ number: to, text }),
    });
  }

  async sendAudio(instanceName: string, to: string, base64Audio: string) {
    return this.req<any>(`/message/sendWhatsAppAudio/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ number: to, audio: base64Audio, encoding: true }),
    });
  }

  /** Envia um arquivo (base64) como documento; o nome e o tipo aparecem no WhatsApp. */
  async sendDocument(instanceName: string, to: string, base64: string, fileName: string, mimetype: string, caption?: string) {
    return this.req<any>(`/message/sendMedia/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ number: to, mediatype: "document", media: base64, fileName, mimetype, caption }),
    });
  }

  async sendMedia(instanceName: string, to: string, mediaUrl: string, caption?: string) {
    return this.req<any>(`/message/sendMedia/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ number: to, mediatype: "image", media: mediaUrl, caption }),
    });
  }
}
