// Escolhe quais ferramentas mandar à IA livre pelo assunto da mensagem. As 22 ferramentas pesam ~2.850 tokens em CADA rodada;
// mandar só as do assunto corta cerca de um terço do custo do comando. Na dúvida (nenhum assunto reconhecido), vão todas.

import { normalize } from "./voice";

interface Group {
  /** A pergunta Sim/Não que o Jev responde sobre a mensagem. */
  ask: string;
  tools: string[];
  /** Trechos do texto normalizado (minúsculas, sem acento) que indicam o assunto; casam no começo de uma palavra. Com "!" no fim, só a palavra inteira. */
  words: string[];
}

const GROUPS: Record<string, Group> = {
  clientes: { ask: "O dono quer ver, responder ou resolver conversas de clientes (atendimento no WhatsApp do negócio)?", tools: ["list_conversations", "reply_to_conversation", "set_conversation_status"], words: ["cliente", "conversa", "atendimento", "resolv", "inbox", "lead"] },
  memoria: { ask: "O dono quer que o assistente lembre, esqueça ou liste preferências e fatos sobre ele?", tools: ["remember", "forget", "list_memories"], words: ["lembr", "memoria", "esquec", "prefer", "guarde", "guardar", "salve que", "meu nome"] },
  email: { ask: "O dono quer ler, buscar, responder, escrever ou enviar e-mails (Gmail), ou gerenciar remetentes?", tools: ["google_list_accounts", "gmail_search", "gmail_read", "gmail_send", "email_no_interest", "contact_search"], words: ["email", "e-mail", "gmail", "caixa de entrada", "remetente", "spam", "sem interesse", "inbox", "respond", "responde", "mande um", "manda um", "mandar um", "enviar", "envia", "envie", "escreva pra", "escreve pra", "escrever pra"] },
  drive: { ask: "O dono quer achar ou receber um arquivo (documento, planilha, PDF, foto, contrato) do Google Drive?", tools: ["drive_search", "drive_send_file"], words: ["arquivo", "drive", "pdf", "planilha", "documento", "foto!", "fotos!", "musica!", "musicas!", "contrato", "apresentacao", "slide", "envie o", "mande o", "manda o", "me manda"] },
  contatos: { ask: "O dono quer saber o telefone ou o e-mail de uma pessoa dos contatos?", tools: ["contact_search"], words: ["telefone", "contato", "numero", "celular", "whatsapp d", "email d", "e-mail d"] },
  notas: { ask: "O dono quer anotar uma ideia solta no diário/caderno ou consultar o que já anotou?", tools: ["note_add", "note_search"], words: ["anot", "obsidian", "diario", "caderno"] },
  lembretes: { ask: "O dono quer criar, ver ou mudar uma lista, uma nota ou um lembrete (me lembra, me avisa) para uma data e hora?", tools: ["note_create", "note_list", "note_update"], words: ["nota!", "notas!", "lista", "listas", "lembrete", "lembretes", "me lembr", "me avis", "checklist", "tarefa"] },
  rotina: { ask: "O dono está descrevendo ou mudando horários e hábitos recorrentes da rotina (aula, academia, plantão)?", tools: ["routine_set", "routine_remove"], words: ["rotina", "aula", "academia", "plantao", "habito", "toda segunda", "toda terca", "toda quarta", "toda quinta", "toda sexta", "todo dia", "horario fixo", "treino"] },
  clima: { ask: "O dono quer saber do tempo (chuva, temperatura, previsão) ou está informando onde está?", tools: ["set_location", "get_weather"], words: ["clima", "tempo", "chuva", "chover", "temperatura", "previsao", "frio", "calor", "estou em", "moro em", "minha cidade", "guarda-chuva"] },
  agenda: { ask: "O dono quer ver compromissos da agenda ou marcar, criar ou mudar um evento com data e hora?", tools: ["calendar_list_events", "calendar_create_event"], words: ["agenda", "evento", "reuniao", "compromisso", "consulta", "calendario", "agendar", "agende", "prova", "prazo", "amanha", "hoje", "semana", "marca!", "marque!", "marcar!", "marcado!", "marcada!", "desmarc", "remarc"] },
};

/** Ferramentas que costumam andar juntas: escrever um e-mail pede achar o endereço da pessoa; um arquivo pode ir por e-mail. */
const ALSO: Record<string, string[]> = { email: ["contatos"], drive: ["email"] };

/** Todas as ferramentas que algum assunto cobre (um teste confere que nenhuma ferramenta fica de fora). */
export const GROUPED_TOOLS = new Set(Object.values(GROUPS).flatMap((g) => g.tools));

/**
 * Nomes das ferramentas a mandar, ou null para mandar todas (nenhum assunto reconhecido, ou assunto demais para ganhar algo).
 * `text` é a mensagem do dono, como foi escrita.
 */
export function selectToolNames(text: string): Set<string> | null {
  const flat = ` ${normalize(text)} `;
  const raw = ` ${text.toLowerCase()} `;
  const hit = new Set<string>();
  for (const [name, g] of Object.entries(GROUPS)) {
    const found = g.words.some((w) => {
      if (w.endsWith("!")) return flat.includes(` ${w.slice(0, -1)} `);
      return flat.includes(` ${w}`) || raw.includes(` ${w}`);
    });
    if (found) hit.add(name);
  }
  for (const name of [...hit]) for (const extra of ALSO[name] ?? []) hit.add(extra);
  if (!hit.size || hit.size >= 5) return null;
  return new Set([...hit].flatMap((n) => GROUPS[n].tools));
}

// ─── Jev: quando as palavras-chave não resolvem ──────────────────

/** Um assunto e a probabilidade (0 a 1) de a mensagem ser sobre ele. */
export interface DomainJudgment {
  id: string;
  p: number;
}

export const GROUP_IDS = Object.keys(GROUPS);
export const groupQuestion = (id: string) => GROUPS[id].ask;

/** A partir daqui o assunto vale (20%, medido nos casos de avaliação; generoso de propósito: incluir um assunto a mais custa pouco, faltar uma ferramenta custa caro). */
export const JEV_INCLUDE_MIN = 0.2;
/** Só abaixo disto, em TODOS os assuntos, o Jev está seguro de que é conversa geral e vai só o mínimo. */
export const JEV_NONE_MAX = 0.1;
/** Ferramentas que seguem na conversa geral: baratas e úteis em qualquer pedido. */
const MINIMAL = ["remember", "list_memories"];

function toolsOf(domains: string[]): Set<string> {
  const hit = new Set(domains);
  for (const name of [...hit]) for (const extra of ALSO[name] ?? []) hit.add(extra);
  return new Set([...hit].flatMap((n) => GROUPS[n].tools));
}

/**
 * Decide as ferramentas: primeiro pelas palavras-chave (de graça); se elas não reconhecem assunto, pergunta ao Jev.
 * Devolve null (todas as ferramentas) sempre que há dúvida: Jev indisponível, assuntos demais ou probabilidades no meio-termo.
 */
export async function pickTools(text: string, judge?: (text: string) => Promise<DomainJudgment[] | null>): Promise<Set<string> | null> {
  const byWords = selectToolNames(text);
  if (byWords || !judge) return byWords;
  let j: DomainJudgment[] | null = null;
  try {
    j = await judge(text);
  } catch {
    return null;
  }
  if (!j?.length) return null;
  const hit = j.filter((x) => x.p >= JEV_INCLUDE_MIN).map((x) => x.id);
  if (hit.length) return hit.length >= 5 ? null : toolsOf(hit);
  return j.every((x) => x.p < JEV_NONE_MAX) ? new Set(MINIMAL) : null;
}
