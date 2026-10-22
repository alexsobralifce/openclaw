// Classificação de e-mails recebidos (lógica pura). Não apaga nem move nada no Gmail: só decide o que mostrar.

/**
 * person: parece escrito por uma pessoa (mostrado em destaque)
 * auto:   notificação/recibo/aviso automático (mostrado, mas compacto)
 * promo:  propaganda/newsletter (oculto)
 * spam:   lixo ou golpe provável (oculto)
 */
import { normalize } from "./voice";
import { isMutedSender, MutePrefs } from "./email-mute";

export type EmailKind = "person" | "auto" | "promo" | "spam" | "muted";

export interface EmailSignals {
  de?: string;
  assunto?: string;
  resumo?: string;
  /** labelIds do Gmail (SPAM, CATEGORY_PROMOTIONS...) */
  labels?: string[];
  /** Cabeçalhos úteis, com nomes em minúsculas (list-unsubscribe, precedence, x-spam-flag...) */
  sinais?: Record<string, string>;
}

export interface EmailClass {
  kind: EmailKind;
  /** Por que foi classificado assim (mostrado nos ocultos) */
  reasons: string[];
  /** Suspeito, mas não o bastante para ocultar: a lista mostra um aviso */
  warn: string[];
}

export const isHidden = (k: EmailKind) => k === "spam" || k === "promo";

const SPAM_TEXT: [RegExp, string][] = [
  [/voc[eê] (foi )?(ganhou|sorteado|premiado|selecionado)|ganhe (dinheiro|r\$|\d)|pr[eê]mio (exclusivo|garantido)|\byou have won\b|claim your (prize|reward)/i, "promete prêmio ou dinheiro"],
  [/cassino|\bbets?\b|jogo do tigrinho|apostas? gr[aá]tis|\bcasino\b/i, "apostas/cassino"],
  [/viagra|cialis|emagre[cç]a (r[aá]pido|\d+ ?kg)|\bpharmacy\b/i, "produtos de saúde suspeitos"],
  [/empr[eé]stimo (aprovado|pr[eé]-?aprovado|sem consulta)|limpa nome|renegocie sua d[ií]vida|renda extra|bitcoin.{0,40}(lucro|invista)|invista.{0,40}bitcoin/i, "oferta financeira suspeita"],
  [/(sua conta|seu acesso|seu cart[aã]o|seu cadastro).{0,20}(foi |ser[aá] |est[aá] )?(bloquead|suspens|cancelad)|verifique (sua|seus) (conta|dados)|atualize (seus|os) dados (banc[aá]rios|do cart[aã]o)|confirme (sua )?senha|verify your account/i, "cara de phishing (conta bloqueada/verificar dados)"],
  [/heran[cç]a|transfer[eê]ncia de fundos|\bnigeria\b/i, "golpe de herança/transferência"],
  [/\bclick here\b|\bact now\b|100% free|\bwinner\b/i, "linguagem típica de spam"],
];

const PROMO_TEXT = /desconto|oferta|promo[cç][aã]o|cupom|% ?off|\bfrete gr[aá]tis|black friday|liquida[cç][aã]o|[uú]ltimas unidades|aproveite|newsletter|s[oó] hoje|imperd[ií]vel|\bsale\b/i;
const AUTO_SENDER = /^(no-?reply|noreply|do-?not-?reply|donotreply|notifications?|notificacoes?|notificacao|mailer-daemon|postmaster|newsletter|alerts?|alertas?|bounce|automated)([+._-][\w.-]*)?@/i;
const THREAD_REPLY = /^\s*(re|res|enc|fwd?)\s*:/i;

const addrOf = (from = "") => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();

export function classifyEmail(m: EmailSignals, muted?: MutePrefs): EmailClass {
  // Remetente marcado como "sem interesse": sai da lista antes de qualquer outra regra
  if (isMutedSender(muted, m.de)) return { kind: "muted", reasons: ["remetente marcado como sem interesse"], warn: [] };
  const labels = new Set(m.labels ?? []);
  const h = m.sinais ?? {};
  const subject = m.assunto ?? "";
  const text = `${subject}\n${m.resumo ?? ""}`;

  // Sinais fortes: o próprio Gmail/servidor de origem já marcou como spam
  const strong: string[] = [];
  if (labels.has("SPAM")) strong.push("o Gmail marcou como spam");
  if (/^yes\b/i.test(h["x-spam-flag"] ?? "") || /^yes\b/i.test(h["x-spam-status"] ?? "")) strong.push("o servidor marcou como spam");
  if (strong.length) return { kind: "spam", reasons: strong, warn: [] };

  // Pontuação de sinais fracos
  let score = 0;
  const reasons: string[] = [];
  if (/\b(spf|dkim|dmarc)=fail\b/i.test(h["authentication-results"] ?? "")) {
    score += 2;
    reasons.push("remetente não passou na verificação (SPF/DKIM)");
  }
  for (const [re, why] of SPAM_TEXT) {
    if (re.test(text)) {
      score += 2;
      reasons.push(why);
    }
  }
  if (/!{3,}/.test(subject)) {
    score += 1;
    reasons.push("muitas exclamações");
  }
  const letters = subject.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 15 && letters.replace(/[^A-ZÀ-Ý]/g, "").length / letters.length > 0.7) {
    score += 1;
    reasons.push("assunto todo em maiúsculas");
  }

  // Resposta dentro de uma conversa (Re:/Enc:) vem de gente: só é spam com sinal forte (tratado acima)
  const isThread = THREAD_REPLY.test(subject);
  if (score >= 3 && !isThread) return { kind: "spam", reasons, warn: [] };

  const unsub = !!h["list-unsubscribe"];
  const bulk = /\b(bulk|list|junk)\b/i.test(h["precedence"] ?? "");
  if (!isThread) {
    if (labels.has("CATEGORY_PROMOTIONS")) return { kind: "promo", reasons: ["categoria Promoções do Gmail"], warn: [] };
    if (unsub && bulk) return { kind: "promo", reasons: ["e-mail em massa (com opção de descadastrar)"], warn: [] };
    if (PROMO_TEXT.test(text) && (unsub || bulk)) return { kind: "promo", reasons: ["propaganda/newsletter"], warn: [] };
  }

  const warn = score > 0 ? reasons : [];
  const autoHeader = !!h["auto-submitted"] && !/^no$/i.test(h["auto-submitted"]);
  if (
    !isThread &&
    (labels.has("CATEGORY_UPDATES") || labels.has("CATEGORY_FORUMS") || labels.has("CATEGORY_SOCIAL") || AUTO_SENDER.test(addrOf(m.de)) || autoHeader || unsub || /auto_?reply/i.test(h["precedence"] ?? ""))
  ) {
    return { kind: "auto", reasons: ["mensagem automática"], warn };
  }
  return { kind: "person", reasons: [], warn };
}

/** Pessoas primeiro, automáticos depois; a ordem original (do mais antigo ao mais novo) é mantida dentro de cada grupo. */
export function groupOrder<T extends { kind?: EmailKind }>(items: T[]): T[] {
  return [...items.filter((m) => m.kind !== "auto"), ...items.filter((m) => m.kind === "auto")];
}

// ─── Plano por áudio: um áudio, vários e-mails ────────────────

export interface BatchPlan {
  /** e-mails a responder, com o que o dono quer dizer em cada (n = número na lista, começando em 1) */
  replies: { n: number; instrucao: string }[];
  ignored: number[];
}

/** Lê o JSON devolvido pela IA e descarta o que não faz sentido (números fora da lista, repetidos, instrução vazia). */
export function parseBatchPlan(raw: string, count: number, max = 6): BatchPlan {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { replies: [], ignored: [] };
  }
  const seen = new Set<number>();
  const plan: BatchPlan = { replies: [], ignored: [] };
  for (const it of Array.isArray(data?.itens) ? data.itens : []) {
    const n = Number(it?.n);
    if (!Number.isInteger(n) || n < 1 || n > count || seen.has(n)) continue;
    seen.add(n);
    if (it?.acao === "ignorar") plan.ignored.push(n);
    else if (it?.acao === "responder" && typeof it.instrucao === "string" && it.instrucao.trim()) {
      if (plan.replies.length < max) plan.replies.push({ n, instrucao: it.instrucao.trim().slice(0, 500) });
    }
  }
  return plan;
}

/**
 * A fala parece instrução de resposta a e-mails da lista? ("no 1 confirmo presença", "responda o primeiro dizendo...").
 * Serve para não sequestrar pedidos livres ("mostre a agenda de amanhã") na tela da lista.
 * `flat` = texto já normalizado (minúsculas, sem acentos nem pontuação).
 */
export function looksLikeBatchReply(flat: string): boolean {
  if (flat.split(" ").length < 4) return false;
  const verb = /\b(respond\w*|resposta|confirm\w*|diga|dizer|avis\w*|peca|pedir|pede|agradec\w*|recus\w*|aceit\w*|ignor\w*|mande|mandar|manda|explic\w*)\b/.test(flat);
  const ref = /\b(no|na|o|a|e-?mail|email|numero)\s+(\d{1,2}|primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sext[oa]|ultim[oa])\b/.test(flat);
  return verb && (ref || /\b(todos|todas|esses|esse|estes|os dois|as duas)\b/.test(flat));
}

// ─── Apagar em lote: um comando, vários e-mails ────────────────

export interface BulkDeletePlan {
  /** números válidos (1..count), sem duplicados, na ordem citada, até `max` itens */
  ns: number[];
  /** números citados mas fora do intervalo 1..count (avisar, não silenciar) */
  outOfRange: number[];
}

const NUM_WORD: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const NUM = "\\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez";
const MAX_RANGE = 200;
const EXCEPT = /\b(menos|exceto|except\w*|tirando|tirar|fora|sem)\b/;

const toNum = (w: string) => (/^\d/.test(w) ? Number(w) : NUM_WORD[w]);

/**
 * O texto parece um pedido de apagar vários e-mails da lista? ("apagar emails 1,2,3,4,5,6", "apague de 1 a 6",
 * "apaga todos", "apague os 3 primeiros"). `flat` = texto já normalizado (minúsculas, sem acentos nem pontuação).
 */
export function looksLikeBulkDelete(flat: string): boolean {
  const verb = /\b(apag\w*|exclu\w*|delet\w*|remov\w*|jog\w+\s+(no|pro|para o)\s+lixo|mand\w+\s+(pro|para o)\s+lixo)\b/.test(flat);
  return verb && hasSelector(flat);
}

/**
 * O texto pede para marcar vários e-mails da lista como lidos? ("marque como lidos 1, 2, 3 e 4", "marcar todos como lidos").
 * Não apaga nada, então não pede confirmação.
 */
export function looksLikeBulkRead(flat: string): boolean {
  const verb = /\b(marc\w*|marq\w*|mark\w*|deix\w*|pon\w*|poe|coloc\w*)\b/.test(flat);
  return verb && /\blid[oa]s?\b/.test(flat) && hasSelector(flat);
}

/** O texto cita quais e-mails da lista: números, intervalo, "todos" ou "os N primeiros". */
function hasSelector(flat: string): boolean {
  return /\d/.test(flat) || /\b(todos|todas|tudo)\b/.test(flat) || new RegExp(`\\b(${NUM})\\s+(a|ate|ao)\\s+(${NUM})\\b|\\bprimeir\\w+`).test(flat);
}

/** Lê um trecho do texto e devolve os números citados, na ordem: "1 a 6", "1-6", "2 e 5", "os 3 primeiros", "todos". */
function scanNumbers(seg: string, count: number): number[] {
  const out: number[] = [];
  const re = new RegExp(
    `\\b(${NUM})\\s+primeir\\w+|\\bprimeir\\w+\\s+(${NUM})\\b|\\b(${NUM})\\s*(?:-|a|ate|ao)\\s*(?:o\\s+|a\\s+)?(${NUM})\\b|\\b(todos|todas|tudo)\\b|\\b(\\d{1,3}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\\b`,
    "g",
  );
  for (const m of seg.matchAll(re)) {
    if (m[1] || m[2]) for (let n = 1; n <= Math.min(toNum(m[1] ?? m[2]), MAX_RANGE); n++) out.push(n);
    else if (m[3] && m[4]) {
      const [a, b] = [toNum(m[3]), toNum(m[4])];
      for (let n = Math.min(a, b); n <= Math.min(Math.max(a, b), Math.min(a, b) + MAX_RANGE); n++) out.push(n);
    } else if (m[5]) for (let n = 1; n <= count; n++) out.push(n);
    else if (m[6]) out.push(toNum(m[6]));
  }
  return out;
}

/**
 * Extrai os e-mails citados: números soltos, intervalos ("de 1 a 6"), "todos", "os 3 primeiros" e exceções
 * ("todos menos o 3"). Valida contra `count` e aplica um teto de itens.
 */
export function parseBulkDelete(text: string, count: number, max = 10): BulkDeletePlan {
  return parseBulkSelection(text, count, max);
}

/** Mesma leitura de números para qualquer ação em lote (apagar, marcar como lido). */
export function parseBulkSelection(text: string, count: number, max = 10): BulkDeletePlan {
  const flat = normalize(text).replace(/(\d)\s*-\s*(\d)/g, "$1 a $2");
  const cut = flat.search(EXCEPT);
  const head = cut < 0 ? flat : flat.slice(0, cut);
  const except = new Set(cut < 0 ? [] : scanNumbers(flat.slice(cut), count));
  const seen = new Set<number>();
  const ns: number[] = [];
  const outOfRange: number[] = [];
  for (const n of scanNumbers(head, count)) {
    if (seen.has(n) || except.has(n)) continue;
    seen.add(n);
    if (n < 1 || n > count) outOfRange.push(n);
    else if (ns.length < max) ns.push(n);
  }
  return { ns, outOfRange };
}
