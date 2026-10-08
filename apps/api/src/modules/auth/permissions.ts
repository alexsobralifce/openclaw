/** Serviços que o root/admin libera para cada usuário. */
export const SERVICES = {
  inbox: "Conversas de clientes",
  contacts: "Contatos",
  channels: "Canais (conectar WhatsApp e Google)",
  assistant: "Assistente no WhatsApp",
  email: "E-mail (Gmail)",
  calendar: "Agenda (Google)",
  drive: "Google Drive (buscar e receber arquivos)",
  vault: "Cofre de senhas",
  automations: "Automações",
  spotify: "Spotify (tocar e controlar música)",
  api: "API e webhooks",
} as const;

export type Service = keyof typeof SERVICES;
export type PlatformRole = "ROOT" | "ADMIN" | "USER";
export type UserStatus = "PENDING" | "ACTIVE" | "DISABLED";

export const ALL_SERVICES = Object.keys(SERVICES) as Service[];

/** Serviços sugeridos ao aprovar um usuário de cada nível (o admin pode ajustar). */
export const ROLE_DEFAULTS: Record<PlatformRole, Service[]> = {
  ROOT: ALL_SERVICES,
  ADMIN: ALL_SERVICES,
  USER: ["inbox", "contacts", "channels"],
};

export function isService(s: string): s is Service {
  return Object.prototype.hasOwnProperty.call(SERVICES, s);
}

/**
 * Serviços pausados para todos, menos o root (decisão de 08/10/2026). O que foi liberado em cada usuário continua guardado:
 * para reabrir, tire o serviço desta lista.
 */
export const PAUSED_SERVICES: Service[] = ["inbox", "contacts", "automations", "api"];

/** O root sempre tem tudo; os demais, o que foi liberado individualmente, menos os serviços pausados. */
export function effectiveServices(role: PlatformRole, services: string[]): Service[] {
  if (role === "ROOT") return ALL_SERVICES;
  return services.filter(isService).filter((s) => !PAUSED_SERVICES.includes(s));
}

export function canManageUsers(role: PlatformRole) {
  return role === "ROOT" || role === "ADMIN";
}

/**
 * Quem pode alterar quem: ninguém mexe no root nem em si mesmo por aqui,
 * e só o root promove ou altera administradores.
 */
export function canEditUser(actor: PlatformRole, target: PlatformRole, newRole?: PlatformRole) {
  if (!canManageUsers(actor) || target === "ROOT" || newRole === "ROOT") return false;
  if (actor === "ADMIN" && (target === "ADMIN" || newRole === "ADMIN")) return false;
  return true;
}

/** Serviço exigido por cada escopo da API pública (a chave só vale se o dono tiver o serviço). */
export function serviceForScope(scope: string): Service {
  const area = scope.split(":")[0];
  if (area === "contacts") return "contacts";
  if (area === "conversations" || area === "messages") return "inbox";
  if (area === "email") return "email";
  if (area === "calendar") return "calendar";
  return "api";
}
