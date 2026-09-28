// Configurações do assistente (lógica pura): de quanto em quanto tempo o chat é limpo e volta ao menu.

/** Sem resposta do dono por este tempo, o assistente volta ao menu principal. */
export const IDLE_MENU_MS = Number(process.env.IDLE_MENU_MINUTES || 3) * 60_000;

export const MIN_CLEAN_MINUTES = 10;
/** O WhatsApp só deixa apagar "para todos" mensagens recentes (cerca de 2 dias). */
export const MAX_CLEAN_MINUTES = 48 * 60;
/** Mensagens mais novas que isso nunca são apagadas pela limpeza automática (o dono pode estar lendo). */
export const CLEAN_MIN_AGE_MS = 3 * 60_000;
/** Depois deste prazo o WhatsApp não aceita mais apagar: deixamos de tentar. */
export const CLEAN_GIVE_UP_MS = 60 * 3600_000;

export interface AssistantConfig {
  /** 0 = não limpar automaticamente */
  cleanMinutes: number;
  nextCleanAt?: number;
}

export const configKey = (ws: string) => `cfg:${ws}`;
export const idleKey = (ws: string) => `idle:${ws}`;
export const sentKey = (ws: string) => `sentmsgs:${ws}`;

export const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 60, label: "A cada 1 hora" },
  { minutes: 6 * 60, label: "A cada 6 horas" },
  { minutes: 12 * 60, label: "A cada 12 horas" },
  { minutes: 24 * 60, label: "A cada 24 horas" },
  { minutes: 0, label: "Nunca (desligar)" },
];

const WORD_NUMBERS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20 };

/**
 * Entende "a cada 2 horas", "1,5 h", "30 minutos", "1 dia", "meia hora", "nunca". Devolve minutos, 0 para desligar
 * ou null se não entendeu. Recebe o texto como foi escrito: a vírgula decimal precisa sobreviver à limpeza.
 */
export function parseInterval(text: string): number | null {
  const flat = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d)[.,](\d)/g, "$1_$2")
    .replace(/[.!?,;:"'()]/g, " ")
    .replace(/_/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(nunca|desligar|desativar|desligado|nao limpar|sem limpeza|parar)( de limpar)?$/.test(flat)) return 0;
  if (/\bmeia hora\b/.test(flat)) return 30;
  const m = /(\d+(?:\.\d+)?|[a-z]+)\s*(minutos?|min|horas?|hrs?|h|dias?|d)\b/.exec(flat);
  if (!m) return null;
  const n = /^\d/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1]];
  if (!n || !Number.isFinite(n) || n <= 0) return null;
  const unit = m[2][0] === "m" ? 1 : m[2][0] === "d" ? 1440 : 60;
  return Math.round(n * unit);
}

/** Mensagem de erro se o intervalo estiver fora do que dá para cumprir; vazio se estiver certo (0 = desligado é válido). */
export function intervalProblem(minutes: number): string {
  if (minutes === 0) return "";
  if (minutes < MIN_CLEAN_MINUTES) return `O mínimo é a cada ${MIN_CLEAN_MINUTES} minutos.`;
  if (minutes > MAX_CLEAN_MINUTES) return "O máximo é a cada 48 horas: depois disso o WhatsApp não deixa mais apagar as mensagens.";
  return "";
}

export function fmtInterval(minutes: number): string {
  if (!minutes) return "desligada";
  if (minutes % 1440 === 0) return `a cada ${minutes / 1440} ${minutes === 1440 ? "dia" : "dias"}`;
  if (minutes % 60 === 0) return `a cada ${minutes / 60} ${minutes === 60 ? "hora" : "horas"}`;
  return `a cada ${minutes} minutos`;
}

/** Mensagem que o assistente enviou (ou o dono, no modo "mensagem para si mesmo"), guardada para poder apagar depois. */
export interface SentMessage {
  id: string;
  jid: string;
  instance: string;
  fromMe: boolean;
  at: number;
}

export const SENT_MAX = 400;
export const SENT_TTL_MS = CLEAN_GIVE_UP_MS;

/** Acrescenta uma mensagem à lista (sem repetir), mantendo só as SENT_MAX mais recentes. */
export function addSent(list: SentMessage[], m: SentMessage): SentMessage[] {
  if (list.some((x) => x.id === m.id)) return list;
  const next = [...list, m];
  return next.length > SENT_MAX ? next.slice(next.length - SENT_MAX) : next;
}
