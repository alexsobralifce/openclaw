import { Injectable, Logger } from "@nestjs/common";
import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { DomainJudgment, GROUP_IDS, groupQuestion } from "./tool-select";
import { recordUsage } from "./usage";

/** O que o dono quer com a mensagem, entre os pedidos que o menu atende sozinho (sem chamar o GPT). */
export type Intent = "agenda_add" | "drive_file" | "note_add" | "other";

export interface IntentResult {
  intent: Intent;
  confidence: number;
}

/** Abaixo disto o Jev não decide: vale a regra antiga (ou a IA livre). */
export const MIN_CONFIDENCE = 0.8;
/** Resposta rápida ou nada: este passo roda antes da IA livre e não pode atrasar a conversa. */
const TIMEOUT_MS = 2_500;

const QUESTION = choice("O que o dono da secretária virtual quer fazer com esta mensagem do WhatsApp?", {
  agenda_add: "Pôr um ou mais compromissos na agenda: eventos com data ou hora marcada (marcar, adicionar, prazos, consultas, provas, reuniões).",
  note_add: "Guardar uma anotação, ideia, lembrete solto ou informação para consultar depois, SEM data nem hora marcada (anota isso, guarda isso, registra aí).",
  drive_file: "Achar ou receber um arquivo que está no Google Drive (contrato, planilha, PDF, documento).",
  other: "Qualquer outra coisa: perguntar algo, ver a agenda, e-mails, clima, conversar, mandar e-mail, cofre de senhas, procurar o que já foi anotado.",
});

interface PickKind {
  id: string;
  noun: string;
  question: string;
}
const PICK_RULES = "Considere erro de digitação, falta de acento, palavras a mais ou a menos (artista, sufixo como Jr, extensão do arquivo) e apelido. Se mais de um servir igualmente, ou na dúvida, responda nenhum.";
const PERSON: PickKind = { id: "pessoa", noun: "a pessoa pedida", question: "Qual destes contatos é a pessoa que o dono da secretária procura?" };
const FILE: PickKind = { id: "arquivo", noun: "o arquivo pedido", question: "Qual destes arquivos do Google Drive (música, documento, planilha, foto...) é o que o dono pediu pelo nome ou descrição?" };
const TOPIC: PickKind = { id: "assunto", noun: "o assunto pedido", question: "Qual destes assuntos de nota é o que o dono quer abrir?" };

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
      const res = await this.client.systemOne({ state: { mensagem: text.slice(0, 1_500) }, questions: { intent: QUESTION } });
      this.count(res);
      const { answers } = res;
      const { choice: intent, confidence } = answers.intent;
      // Sem o texto da mensagem: só o suficiente para calibrar o limiar.
      this.logger.log(`Jev: ${intent} (confiança ${confidence.toFixed(2)}, ${text.split(/\s+/).length} palavras)`);
      return { intent, confidence };
    } catch (e: any) {
      this.logger.warn(`Jev indisponível, usando regras: ${e.message}`);
      return null;
    }
  }

  /**
   * Para quais assuntos (e-mail, agenda, notas...) a mensagem serve? Uma pergunta Sim/Não por assunto, todas na mesma chamada
   * (rodam em paralelo). Sem chave, com erro ou com demora devolve null e a IA livre recebe todas as ferramentas.
   */
  async toolDomains(text: string): Promise<DomainJudgment[] | null> {
    if (!this.enabled()) return null;
    try {
      this.client ??= new TypeSafeClient({ timeout: TIMEOUT_MS, retry: { maxRetries: 0 } });
      const questions: any = Object.fromEntries(GROUP_IDS.map((id) => [id, noul(groupQuestion(id))]));
      const res = (await this.client.systemOne({ state: { mensagem: text.slice(0, 1_500) }, questions })) as any;
      this.count(res);
      const { answers } = res;
      return GROUP_IDS.map((id) => ({ id, p: Number(answers[id]?.noul) })).filter((x) => Number.isFinite(x.p));
    } catch (e: any) {
      this.logger.warn(`Jev indisponível para escolher ferramentas, vão todas: ${e.message}`);
      return null;
    }
  }

  /**
   * Qual destes é o que o dono pediu? O Jev escolhe com confiança (ou "nenhum"), para grafias, apelidos e nomes incompletos que a busca
   * por texto não pega. Só vão ao Jev o pedido e os NOMES dos candidatos (nada de e-mail, telefone ou conteúdo). Devolve o índice do
   * candidato, ou null (sem chave, com erro, demora, dúvida, mais de um que sirva ou "nenhum").
   */
  private async pickOne(what: PickKind, query: string, labels: string[]): Promise<number | null> {
    if (!this.enabled() || !labels.length) return null;
    try {
      this.client ??= new TypeSafeClient({ timeout: TIMEOUT_MS, retry: { maxRetries: 0 } });
      const options: Record<string, string> = Object.fromEntries(labels.slice(0, 8).map((l, i) => [`c${i}`, l.slice(0, 90)]));
      options.nenhum = `Nenhum destes é claramente ${what.noun}.`;
      const question = choice(`${what.question} ${PICK_RULES}`, options as any);
      const res = (await this.client.systemOne({ state: { pedido: query.slice(0, 100) }, questions: { escolha: question } })) as any;
      this.count(res);
      const { choice: pick, confidence } = res.answers.escolha;
      // Sem o pedido nem os candidatos: só o suficiente para calibrar o limiar.
      this.logger.log(`Jev (${what.id}): ${pick === "nenhum" ? "nenhum" : "um candidato"} (confiança ${Number(confidence).toFixed(2)}, ${labels.length} candidatos)`);
      const i = /^c(\d+)$/.exec(String(pick));
      return i && confidence >= MIN_CONFIDENCE ? Number(i[1]) : null;
    } catch (e: any) {
      this.logger.warn(`Jev indisponível para escolher (${what.id}): ${e.message}`);
      return null;
    }
  }

  /** Contato (só o nome vai ao Jev). */
  pickPerson(query: string, candidates: { nome: string }[]) {
    return this.pickOne(PERSON, query, candidates.map((c) => c.nome));
  }

  /** Arquivo do Drive (música, documento, planilha...): só os nomes dos arquivos vão ao Jev. */
  pickFile(query: string, files: { nome: string }[]) {
    return this.pickOne(FILE, query, files.map((f) => f.nome));
  }

  /** Assunto de nota entre os existentes. */
  pickNoteTopic(query: string, topics: { name: string }[]) {
    return this.pickOne(TOPIC, query, topics.map((t) => t.name));
  }

  /** Conta a chamada ao Jev no consumo do usuário (o SDK devolve o uso em tokens). Sem preço configurado, os tokens contam pelo maior preço da tabela. */
  private count(res: any) {
    recordUsage("jev", String(res?.model ?? "jev-latest"), { input: Number(res?.usage?.input_tokens) || 0, output: Number(res?.usage?.output_tokens) || 0 });
  }
}
