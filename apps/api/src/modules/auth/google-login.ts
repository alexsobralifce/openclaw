// Ticket de uso único do "Entrar com Google": o callback guarda, o front troca por uma sessão em poucos segundos.
export const LOGIN_TICKET_MS = 60_000;
export const loginTicketKey = (ticket: string) => `glogin:${ticket}`;
