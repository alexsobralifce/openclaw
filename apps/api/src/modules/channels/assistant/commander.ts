import { prisma } from "@openclaw/database";
import { effectiveServices, Service } from "../../auth/permissions";
import { phoneVariants } from "../whatsapp/phone";

/** Usuário que está dando comandos ao assistente, no workspace dele. */
export interface Commander {
  userId: string;
  name: string;
  phone: string;
  workspaceId: string;
  services: Service[];
}

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
  return { userId: user.id, name: user.name, phone: user.phone!, workspaceId, services: effectiveServices(user.role, user.services) };
}

/** Dono do workspace, para avisos que não partem de uma mensagem (e-mails novos, automações). */
export async function workspaceCommander(workspaceId: string): Promise<Commander | null> {
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId, role: "OWNER" }, include: { user: true } });
  const u = m?.user;
  if (!u || u.status !== "ACTIVE" || !u.phone) return null;
  return { userId: u.id, name: u.name, phone: u.phone, workspaceId, services: effectiveServices(u.role, u.services) };
}

/** Instância pela qual o assistente fala com o dono do workspace. */
export async function assistantInstance(workspaceId: string): Promise<string | null> {
  const wa = await prisma.channel.findFirst({ where: { workspaceId, type: "WHATSAPP", isActive: true }, orderBy: { createdAt: "asc" } });
  return (wa?.config as any)?.instanceName ?? (sharedInstance() || null);
}
