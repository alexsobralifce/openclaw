// Nomes recuperados do JavaScript compilado (dist/modules/auth/google-login.js); o fluxo em si
// (login.ts/callback/exchange) é novo nesta recuperação — ver auth.controller.ts.

/** O ticket vale pouco: é só a ponte entre o redirect do Google e o fetch que troca por sessão. */
export const LOGIN_TICKET_MS = 60_000;
export const loginTicketKey = (ticket: string) => `glogin:${ticket}`;

/** Nonce do `state` do OAuth, para o callback recusar um código que não veio do redirect que a API mandou. */
export const LOGIN_STATE_MS = 10 * 60_000;
export const loginStateKey = (state: string) => `glogin-state:${state}`;
