import { prisma } from "@openclaw/database";
import { effectiveServices, Service } from "../../auth/permissions";
import { planExpired } from "../../auth/plans";
import { phoneVariants } from "../whatsapp/phone";
import { APP_INSTANCE, connKey, isChannelKind, isWhatsappDown, pickChannel, TELEGRAM_INSTANCE } from "./channel-route";

/** Serviços liberados; assinatura vencida pausa o assistente (nenhum serviço) até o pagamento voltar. */
const servicesOf = (u: { role: any; services: string[]; plan?: string | null; planUntil?: Date | null }): Service[] => (planExpired(u) ? [] : effectiveServices(u.role, u.services));

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
  /** Canal preferido (whatsapp/app/telegram), quando o usuário já escolheu um. */
  channel?: "whatsapp" | "app" | "telegram" | null;
  telegramChatId?: string | null;
}

const extras = (u: { assistantChannel?: string | null; telegramChatId?: string | null }) => ({
  channel: isChannelKind(u.assistantChannel) ? u.assistantChannel : null,
  telegramChatId: u.telegramChatId ?? null,
});

export const can = (c: Commander, s: Service) => c.services.includes(s);

export const ECHO_TTL_MS = 5 * 60_000;
/** Chave de deduplicação de eco (evita o assistente responder a própria mensagem refletida pelo canal). */
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

/** Usuário pelo id, sem passar por telefone — usado pelo canal do app e pelo Telegram. */
export async function commanderForUser(userId: string): Promise<Commander | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { workspaces: true } });
  const workspaceId = u?.workspaces[0]?.workspaceId;
  if (!u || u.status !== "ACTIVE" || !workspaceId) return null;
  return { userId: u.id, name: u.name, phone: u.phone ?? "", workspaceId, services: servicesOf(u), role: u.role, plan: u.plan ?? null, ...extras(u) };
}

/** Usuário pelo chat do Telegram. */
export async function commanderForTelegram(chatId: string): Promise<Commander | null> {
  const u = await prisma.user.findFirst({ where: { telegramChatId: chatId, status: "ACTIVE" }, select: { id: true } });
  return u ? commanderForUser(u.id) : null;
}

/** Instância de WhatsApp ativa do workspace, se houver. */
export async function whatsappInstance(workspaceId: string): Promise<string | null> {
  const wa = await prisma.channel.findFirst({ where: { workspaceId, type: "WHATSAPP", isActive: true }, orderBy: { createdAt: "asc" } });
  return (wa?.config as any)?.instanceName ?? (sharedInstance() || null);
}

async function connectionOf(instance: string): Promise<{ state?: string } | null> {
  try {
    const row = await prisma.kvEntry.findUnique({ where: { key: connKey(instance) } });
    if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    return row.value as { state?: string };
  } catch {
    return null;
  }
}

export const telegramReady = () => !!process.env.TELEGRAM_BOT_TOKEN;

/** Instância pela qual o assistente fala com o dono do workspace, escolhendo o canal disponível. */
export async function assistantInstance(workspaceId: string, owner?: Commander | null): Promise<string | null> {
  const o = owner ?? (await workspaceCommander(workspaceId));
  const wa = await whatsappInstance(workspaceId);
  const down = wa ? isWhatsappDown(await connectionOf(wa)) : true;
  const pick = pickChannel(o?.channel, { whatsapp: !!wa && !down && !!o?.phone, app: !!o, telegram: telegramReady() && !!o?.telegramChatId });
  if (pick === "app") return APP_INSTANCE;
  if (pick === "telegram") return TELEGRAM_INSTANCE;
  if (pick === "whatsapp") return wa;
  return wa;
}
