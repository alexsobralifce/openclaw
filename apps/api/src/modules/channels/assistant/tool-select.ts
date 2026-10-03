// Escolhe quais ferramentas mandar à IA livre pelo assunto da mensagem. As 22 ferramentas pesam ~2.850 tokens em CADA rodada;
// mandar só as do assunto corta cerca de um terço do custo do comando. Na dúvida (nenhum assunto reconhecido), vão todas.

import { normalize } from "./voice";

interface Group {
  tools: string[];
  /** Trechos do texto normalizado (minúsculas, sem acento) que indicam o assunto; casam no começo de uma palavra. Com "!" no fim, só a palavra inteira. */
  words: string[];
}

const GROUPS: Record<string, Group> = {
  clientes: { tools: ["list_conversations", "reply_to_conversation", "set_conversation_status"], words: ["cliente", "conversa", "atendimento", "resolv", "inbox", "lead"] },
  memoria: { tools: ["remember", "forget", "list_memories"], words: ["lembr", "memoria", "esquec", "prefer", "guarde", "guardar", "salve que", "meu nome"] },
  email: { tools: ["google_list_accounts", "gmail_search", "gmail_read", "gmail_send", "email_no_interest", "contact_search"], words: ["email", "e-mail", "gmail", "caixa de entrada", "remetente", "spam", "sem interesse", "inbox", "responda", "mande um", "envie"] },
  drive: { tools: ["drive_search", "drive_send_file"], words: ["arquivo", "drive", "pdf", "planilha", "documento", "foto!", "fotos!", "musica!", "musicas!", "contrato", "apresentacao", "slide", "envie o", "mande o", "manda o", "me manda"] },
  contatos: { tools: ["contact_search"], words: ["telefone", "contato", "numero", "celular", "whatsapp d", "email d", "e-mail d"] },
  notas: { tools: ["note_add", "note_search"], words: ["nota", "anot", "obsidian", "diario", "caderno"] },
  rotina: { tools: ["routine_set", "routine_remove"], words: ["rotina", "aula", "academia", "plantao", "habito", "toda segunda", "toda terca", "toda quarta", "toda quinta", "toda sexta", "todo dia", "horario fixo", "treino"] },
  clima: { tools: ["set_location", "get_weather"], words: ["clima", "tempo", "chuva", "chover", "temperatura", "previsao", "frio", "calor", "estou em", "moro em", "minha cidade", "guarda-chuva"] },
  agenda: { tools: ["calendar_list_events", "calendar_create_event"], words: ["agenda", "evento", "reuniao", "compromisso", "marc", "consulta", "calendario", "agendar", "agende", "prova", "prazo", "amanha", "hoje", "semana"] },
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
