import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly base = process.env.EVOLUTION_API_URL || "http://localhost:8080";
  private readonly apiKey = process.env.EVOLUTION_API_KEY || "";

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        apikey: this.apiKey,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
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

  async sendMedia(instanceName: string, to: string, mediaUrl: string, caption?: string) {
    return this.req<any>(`/message/sendMedia/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({ number: to, mediatype: "image", media: mediaUrl, caption }),
    });
  }
}
