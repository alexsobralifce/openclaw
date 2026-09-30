import { Injectable, Logger } from "@nestjs/common";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";

/** O que o dono quer com a mensagem, entre os pedidos que o menu atende sozinho (sem chamar o GPT). */
export type Intent = "agenda_add" | "drive_file" | "other";

export interface IntentResult {
  intent: Intent;
  confidence: number;
}

/** Abaixo disto o Jev não decide: vale a regra antiga (ou a IA livre). */
export const MIN_CONFIDENCE = 0.8;
/** Resposta rápida ou nada: este passo roda antes da IA livre e não pode atrasar a conversa. */
const TIMEOUT_MS = 2_500;

const QUESTION = choice("O que o dono da secretária virtual quer fazer com esta mensagem do WhatsApp?", {
  agenda_add: "Pôr um ou mais compromissos na agenda (marcar, anotar, adicionar eventos, prazos, consultas, provas).",
  drive_file: "Achar ou receber um arquivo que está no Google Drive (contrato, planilha, PDF, documento).",
  other: "Qualquer outra coisa: perguntar algo, ver a agenda, e-mails, clima, conversar, mandar e-mail, cofre de senhas.",
});

/** Só aceita a resposta do Jev quando ele está seguro; "other" nunca desvia o fluxo. */
export function acceptIntent(r: IntentResult | null, wanted: Exclude<Intent, "other">, min = MIN_CONFIDENCE): boolean {
  return !!r && r.intent === wanted && r.confidence >= min;
}

/**
 * Entende a intenção da mensagem com o Jev (TypeSafe): uma escolha tipada com confiança, em vez de regex de verbos.
 * Sem chave, com erro ou com demora, devolve null e o menu segue com as regras antigas.
 */
@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  private client?: TypeSafeClient;

  enabled() {
    return !!process.env.TYPESAFE_API_KEY;
  }

  async classify(text: string): Promise<IntentResult | null> {
    if (!this.enabled()) return null;
    try {
      this.client ??= new TypeSafeClient({ timeout: TIMEOUT_MS, retry: { maxRetries: 0 } });
      const { answers } = await this.client.systemOne({ state: { mensagem: text.slice(0, 1_500) }, questions: { intent: QUESTION } });
      const { choice: intent, confidence } = answers.intent;
      // Sem o texto da mensagem: só o suficiente para calibrar o limiar.
      this.logger.log(`Jev: ${intent} (confiança ${confidence.toFixed(2)}, ${text.split(/\s+/).length} palavras)`);
      return { intent, confidence };
    } catch (e: any) {
      this.logger.warn(`Jev indisponível, usando regras: ${e.message}`);
      return null;
    }
  }
}
