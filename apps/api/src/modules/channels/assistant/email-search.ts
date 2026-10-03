// Busca no Gmail por pedido escrito ou falado (lógica pura): "buscar e-mails do Marcos", "e-mails sobre contrato".

import { dropNameNoise, NOT_A_NAME } from "./contacts";

export interface EmailSearchSpec {
  /** consulta na sintaxe do Gmail */
  gmail: string;
  /** como mostrar o pedido: "de marcos" / "sobre contrato" */
  label: string;
}

const VERB = "(?:buscar|busca|procurar|procura|achar|acha|pesquisar|pesquisa|encontrar|encontra|localizar|localiza)";
const MAILS = "(?:e-?mails?|mensagens?)";
const FROM = /^(do|da|de|dos|das)$/;
const ABOUT = /^(sobre|com|contendo|assunto)$/;

/** Só letras, números e @ . _ - no que vai para a consulta do Gmail (sem operadores nem aspas do usuário). */
const safe = (t: string) => t.replace(/[^a-z0-9@._\- ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

function spec(connector: string | undefined, what: string): EmailSearchSpec | null {
  const term = safe(what);
  if (term.length < 2 || NOT_A_NAME.test(term)) return null;
  if (connector && FROM.test(connector)) {
    // "arnaud jr" no pedido, "Arnaud" no cabeçalho do e-mail: o Gmail exigiria as duas palavras, então fica só o nome que importa
    const who = safe(dropNameNoise(term)) || term;
    return { gmail: `(from:(${who}) OR to:(${who}))`, label: `de ${who}` };
  }
  return { gmail: term, label: `sobre ${term}` };
}

/**
 * Entende o pedido de buscar e-mails. `flat` = texto normalizado. Devolve null se não for isso.
 * "email do Marcos" (singular) é o telefone/e-mail de um contato, não esta busca.
 */
export function emailSearchSpec(flat: string): EmailSearchSpec | null {
  // Com verbo: "buscar e-mails do Marcos", "procura no gmail contrato", "pesquisar emails sobre prova"
  const withVerb = flat.match(new RegExp(`^(?:por favor )?(?:me )?${VERB} (?:no gmail|(?:os |meus |todos os )?${MAILS})(?: no gmail)?(?: (do|da|de|dos|das|sobre|com|contendo|assunto))? (.{2,80})$`));
  if (withVerb) return spec(withVerb[1], withVerb[2]);
  // Plural sem verbo: "e-mails do Marcos", "emails sobre contrato" (hoje/novos continuam sendo o comando de ler e-mails)
  const plain = flat.match(/^(?:me )?(?:mostra |mostrar |ver )?(?:os |meus )?e-?mails (do|da|de|dos|das|sobre|com|contendo) (.{2,80})$/);
  if (plain) return spec(plain[1], plain[2]);
  return null;
}
