import { prisma } from "@openclaw/database";
import { effectiveServices, Service } from "../../auth/permissions";
import { planExpired } from "../../auth/plans";

/** Serviços liberados; assinatura vencida pausa o assistente (nenhum serviço) até o pagamento voltar. */
const servicesOf = (u: { role: any; services: string[]; plan?: string | null; planUntil?: Date | null }): Service[] => (planExpired(u) ? [] : effectiveServices(u.role, u.services));
import { phoneVariants } from "../whatsapp/phone";
import { ChannelKind, connKey, ConnState, isChannelKind, isWhatsappDown, pickChannel, APP_INSTANCE, TELEGRAM_INSTANCE } from "./channel-route";

/** Usuário que está dando comandos ao assistente, no workspace dele. */
export interface Commander {
  userId: string;
  name: string;
  phone: string;
  workspaceId: string;
  services: Service[];
  /** Nível na plataforma; root e admin não têm limite de IA. */
  role?: string;
  /** Plano comercial (nulo = sem plano: valem os limites gerais do ambiente). */
  plan?: string | null;
  /** Canal principal escolhido pelo usuário (nulo = app). */
  channel?: ChannelKind | null;
  /** Chat do Telegram vinculado (nulo = sem Telegram). */
  telegramChatId?: string | null;
}

const extras = (u: any) => ({ channel: isChannelKind(u.assistantChannel) ? u.assistantChannel : null, telegramChatId: u.telegramChatId ?? null });

export const can = (c: Commander, s: Service) => c.services.includes(s);

/** Mensagens enviadas pelo sistema ficam marcadas por um tempo: ao voltarem pelo webhook, não viram comandos. */
export const ECHO_TTL_MS = 5 * 60_000;
export const echoKey = (id: string) => `echo:${id}`;

/** Instância de WhatsApp compartilhada por todos os usuários (opcional; ver .env.example). */
export const sharedInstance = () => process.env.ASSISTANT_SHARED_INSTANCE || "";

/**
 * Identifica o usuário pelo telefone. Só vale se a mensagem chegou por um WhatsApp do próprio
 * workspace dele (ou pela instância compartilhada), para que o conteúdo pessoal não passe
 * pelo WhatsApp de outra pessoa.
 */
export async function findCommander(phone: string, channelWorkspaceId: string, instance: string): Promise<Commander | null> {
  const user = await prisma.user.findFirst({
    where: { phone: { in: phoneVariants(phone) }, status: "ACTIVE" },
    include: { workspaces: true },
  });
  const workspaceId = user?.workspaces[0]?.workspaceId;
  if (!user || !workspaceId) return null;
  if (workspaceId !== channelWorkspaceId && sharedInstance() !== instance) return null;
  return { userId: user.id, name: user.name, phone: user.phone!, workspaceId, services: servicesOf(user), role: user.role, plan: user.plan ?? null, ...extras(user) };
}

/** Dono do workspace, para avisos que não partem de uma mensagem (e-mails novos, automações). */
export async function workspaceCommander(workspaceId: string): Promise<Commander | null> {
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: "OWNER" }, include: { user: true } });
  const u = m?.user;
  if (!u || u.status !== "ACTIVE") return null;
  return { userId: u.id, name: u.name, phone: u.phone ?? "", workspaceId, services: servicesOf(u), role: u.role, plan: u.plan ?? null, ...extras(u) };
}

/** O usuário logado no app ou vinculado ao Telegram, como comandante do assistente (sem passar pelo número de telefone). */
export async function commanderForUser(userId: string): Promise<Commander | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { workspaces: true } });
  const workspaceId = u?.workspaces[0]?.workspaceId;
  if (!u || u.status !== "ACTIVE" || !workspaceId) return null;
  return { userId: u.id, name: u.name, phone: u.phone ?? "", workspaceId, services: servicesOf(u), role: u.role, plan: u.plan ?? null, ...extras(u) };
}

/** O usuário que está vinculado a este chat do Telegram. */
export async function commanderForTelegram(chatId: string): Promise<Commander | null> {
  const u = await prisma.user.findFirst({ where: { telegramChatId: chatId, status: "ACTIVE" }, select: { id: true } });
  return u ? commanderForUser(u.id) : null;
}

/** Instância do WhatsApp do workspace (a primeira ativa; sem ela, a compartilhada), ou null. */
export async function whatsappInstance(workspaceId: string): Promise<string | null> {
  const wa = await prisma.channel.findFirst({ where: { workspaceId, type: "WHATSAPP", isActive: true }, orderBy: { createdAt: "asc" } });
  return (wa?.config as any)?.instanceName ?? (sharedInstance() || null);
}

/** Último estado de conexão registrado para a instância (ver o evento connection.update no InboundService). */
async function connectionOf(instance: string): Promise<ConnState | null> {
  try {
    const row = await prisma.kvEntry.findUnique({ where: { key: connKey(instance) } });
    if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    return row.value as unknown as ConnState;
  } catch {
    return null;
  }
}

/** O Telegram só serve se o bot está configurado no servidor e o usuário vinculou o chat dele. */
export const telegramReady = () => !!process.env.TELEGRAM_BOT_TOKEN;

/**
 * Para onde vão os avisos que o assistente começa (e-mail novo, lembretes, automações): o canal preferido do dono do workspace
 * se estiver disponível; senão o próximo. O WhatsApp só conta se existir e não estiver desconectado; o app sempre está disponível
 * (a mensagem fica no histórico e chega por notificação quando o usuário tiver autorizado).
 * Devolve o nome da instância do WhatsApp, "app" ou "telegram".
 */
export async function assistantInstance(workspaceId: string, owner?: Commander | null): Promise<string | null> {
  const o = owner ?? (await workspaceCommander(workspaceId));
  const wa = await whatsappInstance(workspaceId);
  const down = wa ? isWhatsappDown(await connectionOf(wa)) : true;
  const pick = pickChannel(o?.channel, { whatsapp: !!wa && !down && !!o?.phone, app: !!o, telegram: telegramReady() && !!o?.telegramChatId });
  if (pick === "app") return APP_INSTANCE;
  if (pick === "telegram") return TELEGRAM_INSTANCE;
  if (pick === "whatsapp") return wa;
  // Sem dono ativo (ou sem nada disponível): comportamento antigo, a instância do WhatsApp, se houver
  return wa;
}
