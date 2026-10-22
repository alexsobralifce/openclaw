// Pedidos do cofre de senhas pelo WhatsApp (lógica pura).

/** Tempo até a resposta com a senha ser apagada do chat. */
export const SECRET_WIPE_MS = 60_000;

const CONNECTORS = new Set(["do", "da", "de", "dos", "das", "no", "na", "nos", "nas", "para", "pra", "pro", "site", "conta", "app", "aplicativo", "servico", "sistema", "meu", "minha", "o", "a"]);
const LEAD = /^(?:(?:qual|quais)(?: e| sao)?(?: o| a| as| os)?|(?:me )?(?:passa|passe|manda|mande|diz|diga|fala|fale|envia|envie|mostra|mostre|da|de|traz|traga|ve|ver|busca|busque|procura|procure|acha|ache|lembra|lembre)(?: pra mim)?(?: a| as)?|preciso d[ao]s?|quero(?: a| as)?|pega(?: a| as)?)\s+/;

/**
 * "senha do github", "qual a senha do meu banco", "me passa o login do instagram" → "github" / "banco" / "instagram".
 * `flat` = texto normalizado (minúsculas, sem acentos nem pontuação). Devolve null se não for um pedido de senha.
 */
export function vaultQuery(flat: string): string | null {
  let t = flat.trim();
  for (let i = 0; i < 3 && LEAD.test(t); i++) t = t.replace(LEAD, "");
  const m = /^(?:a |o |as |os )?(?:senhas?|logins?|credenciais|credencial)\b\s*(.*)$/.exec(t);
  if (!m) return null;
  const words = m[1].split(" ").filter(Boolean);
  while (words.length && CONNECTORS.has(words[0])) words.shift();
  const q = words.join(" ").trim();
  return q.length >= 2 ? q : null;
}

export const isVaultHome = (flat: string) => /^(?:abrir |ver |mostrar )?(?:o )?cofre(?: de senhas?)?$|^(?:meu )?gerenciador de senhas$/.test(flat);
export const isVaultLock = (flat: string) => /^(?:bloquear|trancar|fechar) (?:o )?cofre(?: de senhas?)?$/.test(flat);

/**
 * A mensagem parece entregar uma senha ("minha senha é Abc123!", "senha do banco: x9#kd2")? O texto cru é analisado: exige
 * o valor com dígito ou símbolo, para não confundir com "a senha é fácil de lembrar".
 */
export function looksLikeSharedSecret(text: string): boolean {
  return /\b(?:minha\s+senha|a\s+senha|senha|password|pin|cvv|token)\b[^\n]{0,30}?(?:\s(?:é|e|eh|foi|virou)\s+|\s*[:=]\s*)(?=\S*[\d!@#$%^&*_+=\-])\S{6,}/i.test(text);
}
