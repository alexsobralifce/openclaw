import { endSession } from "./auth";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Item do menu principal do WhatsApp; `hidden` = fora da lista, `locked` = sempre visível. */
export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  hidden: boolean;
  locked: boolean;
}

export interface BugReport {
  id: string;
  userName: string;
  userEmail: string;
  message: string;
  page: string | null;
  status: "NOVO" | "EM_ANALISE" | "RESOLVIDO";
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    // Só a sessão inválida (resposta padrão "Unauthorized") derruba o login; um 401 com mensagem própria
    // (ex.: senha mestra ou chave de recuperação do cofre incorretas) é erro da tela, não fim de sessão.
    const err = await res.json().catch(() => ({}));
    if (err.message && err.message !== "Unauthorized") throw new Error(err.message);
    await endSession();
    window.location.href = "/";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Conta desativada ou pendente: encerra a sessão e mostra o motivo no login
    // Assinatura vencida: leva para Configurações, onde se renova
    if (res.status === 403 && err.code === "PLAN_EXPIRED" && typeof window !== "undefined" && !window.location.pathname.startsWith("/dashboard/settings")) {
      window.location.href = "/dashboard/settings";
    }
    if (res.status === 403 && err.code === "ACCOUNT_INACTIVE" && typeof window !== "undefined") {
      await endSession();
      window.location.href = `/auth/login?motivo=${encodeURIComponent(err.message)}`;
    }
    const msg = Array.isArray(err.message) ? err.message.join("; ") : err.message;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Plano comercial e seus limites (vem de /users/plans). */
export interface PlanInfo {
  id: string;
  name: string;
  priceBrl: number;
  aiUsd: number;
  googleAccounts: number;
  pdfPages: number;
  audioSeconds: number;
  services: string[];
  summary: string;
}

export interface NoteItem {
  text: string;
  done: boolean;
}

/** Nota em lista, com lembrete opcional (data e hora em que o assistente a manda). */
export interface ListNote {
  id: string;
  title: string;
  items: NoteItem[];
  remindAt: string | null;
  remindedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageReport {
  days: number;
  since: string;
  total: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; unpricedTokens: number };
  avgMonthlyUsd: number;
  monthlyLimitUsd: number;
  activeUsers: number;
  usdBrl: number | null;
  pricedModels: string[];
  byDay: { day: string; tokens: number }[];
  users: {
    userId: string;
    name: string;
    email: string | null;
    role: string | null;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    byProvider: Record<string, { calls: number; tokens: number }>;
    lastDay: string;
    costUsd: number;
    unpricedTokens: number;
    monthlyUsd: number;
    monthUsd: number;
    limitUsd: number;
    plan: string | null;
    status: string | null;
  }[];
}

/** Arquivo de uma lista do Drive mostrada no chat (cada um tem o botão de baixar). */
export interface ChatListedFile {
  id: string;
  account: string;
  nome: string;
  tipo: string;
  tamanho: number;
}

/** Documento do catálogo (PDF guardado no Drive, com tags). */
export interface DocumentView {
  id: string;
  kind: "pdf" | "nota";
  title: string;
  topic: string;
  tags: string[];
  summary: string;
  mime: string;
  sizeBytes: number;
  pages: number | null;
  origin: string;
  createdAt: string;
}

/** Mensagem do chat do assistente no app. */
export interface ChatMessage {
  id: string;
  direction: "IN" | "OUT";
  kind: string;
  text: string;
  meta: { fileId?: string; fileName?: string; mime?: string; size?: number; files?: ChatListedFile[] } | null;
  createdAt: string;
}

export const api = {
  documents: {
    list: (q?: string, tag?: string, category?: string) => {
      const p = new URLSearchParams();
      if (q?.trim()) p.set("q", q.trim());
      if (tag) p.set("tag", tag);
      if (category) p.set("category", category);
      return request<{ documents: DocumentView[]; tags: { tag: string; count: number }[]; categories: { name: string; count: number }[]; total: number }>(`/documents${p.size ? `?${p}` : ""}`);
    },
    update: (id: string, patch: { tags?: string[]; title?: string; topic?: string }) => request<DocumentView>(`/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Guarda um PDF novo no Drive e no catálogo, já na categoria escolhida (nova ou existente). */
    upload: (body: { base64: string; mime: string; category: string }) => request<DocumentView>("/documents", { method: "POST", body: JSON.stringify(body) }),
    createCategory: (name: string) => request<{ name: string; categories: { name: string; count: number }[] }>("/documents/categories", { method: "POST", body: JSON.stringify({ name }) }),
    /** Apaga a categoria; os documentos dela vão para "Sem categoria". */
    removeCategory: (name: string) => request<{ moved: number; categories: { name: string; count: number }[] }>(`/documents/categories?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
    /** Baixa na hora, do Drive do usuário. Arquivo grande demais: o erro traz o link do Drive em `link`. */
    download: async (id: string): Promise<Blob> => {
      const res = await fetch(`${API}/api/v1/documents/${encodeURIComponent(id)}/download`, { credentials: "include" });
      if (!res.ok) {
        const err: any = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.message || "Não consegui baixar o documento."), { link: typeof err.link === "string" ? err.link : null });
      }
      return res.blob();
    },
  },
  appChat: {
    messages: (after?: string) => request<ChatMessage[]>(`/app-chat/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`),
    /** Ao abrir o app: pede o menu principal se a conversa está vazia ou parada (a resposta chega pelo tempo real). */
    open: () => request<{ opened: boolean; askLocation?: boolean }>("/app-chat/open", { method: "POST" }),
    location: (lat: number, lng: number) => request<{ ok: boolean }>("/app-chat/location", { method: "POST", body: JSON.stringify({ lat, lng }) }),
    locationDenied: () => request<{ ok: boolean }>("/app-chat/location/denied", { method: "POST" }),
    send: (text: string) => request<ChatMessage>("/app-chat/messages", { method: "POST", body: JSON.stringify({ text }) }),
    sendAudio: (body: { base64: string; mime: string; seconds: number }) => request<ChatMessage>("/app-chat/audio", { method: "POST", body: JSON.stringify(body) }),
    sendFile: (body: { base64: string; mime: string; name: string; caption?: string }) => request<ChatMessage>("/app-chat/file", { method: "POST", body: JSON.stringify(body) }),
    setChannel: (channel: "whatsapp" | "app" | "telegram") => request<{ channel: string }>("/app-chat/channel", { method: "PUT", body: JSON.stringify({ channel }) }),
    pushStatus: () => request<{ enabled: boolean; publicKey: string; subscribed: boolean }>("/app-chat/push"),
    pushSubscribe: (sub: unknown) => request<any>("/app-chat/push", { method: "POST", body: JSON.stringify(sub) }),
    pushUnsubscribe: (endpoint: string) => request<any>("/app-chat/push", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
    /** Baixa um arquivo da lista do Drive, direto da conta do usuário. Se for grande demais, o erro traz o link do Drive em `link`. */
    driveFile: async (id: string, account: string): Promise<Blob> => {
      const res = await fetch(`${API}/api/v1/app-chat/drive/${encodeURIComponent(id)}?account=${encodeURIComponent(account)}`, { credentials: "include" });
      if (!res.ok) {
        const err: any = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.message || "Não consegui baixar o arquivo."), { link: typeof err.link === "string" ? err.link : null });
      }
      return res.blob();
    },
    /** Baixa um arquivo enviado pelo assistente (precisa da sessão, então não dá para usar um link direto). */
    file: async (id: string): Promise<Blob> => {
      const res = await fetch(`${API}/api/v1/app-chat/files/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Arquivo não encontrado ou expirado.");
      return res.blob();
    },
  },
  telegram: {
    status: () => request<{ configured: boolean; linked: boolean }>("/channels/telegram/status"),
    link: () => request<{ code: string; expiresInSeconds: number; bot: string; url: string | null }>("/channels/telegram/link", { method: "POST" }),
    unlink: () => request<{ linked: boolean }>("/channels/telegram/link", { method: "DELETE" }),
  },
  auth: {
    forgot: (email: string) => request<{ ok: boolean }>("/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
    reset: (token: string, password: string) => request<{ ok: boolean }>("/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
    verifyEmail: (token: string) => request<{ ok: boolean }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
    login: (email: string, password: string) =>
      request<{ accessToken: string; user: any }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (data: { email: string; name: string; password: string; workspaceName: string }) =>
      request<{ accessToken?: string; user?: any; pending?: boolean; message?: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    googleExchange: (ticket: string) => request<{ accessToken: string; user: any }>("/auth/google/exchange", { method: "POST", body: JSON.stringify({ ticket }) }),
    me: () => request<any>("/auth/me"),
    services: () => request<Record<string, string>>("/auth/services"),
    updateMe: (data: { name?: string; phone?: string }) =>
      request<any>("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),
  },
  billing: {
    me: () => request<{ plans: PlanInfo[]; plan: string | null; planUntil: string | null; billingStatus: string | null; expired: boolean; configured: boolean; publicKey: string | null }>("/billing/me"),
    pix: (plan: string) => request<{ qrCode: string; qrCodeBase64: string; expiresAt: string }>("/billing/pix", { method: "POST", body: JSON.stringify({ plan }) }),
    subscribeCard: (plan: string, token: string) => request<{ status: string }>("/billing/subscribe-card", { method: "POST", body: JSON.stringify({ plan, token }) }),
    sync: () => request<{ plan: string | null; planUntil: string | null; billingStatus: string | null; expired: boolean }>("/billing/sync", { method: "POST" }),
    checkout: (plan: string, method: "card" | "pix") => request<{ url: string }>("/billing/checkout", { method: "POST", body: JSON.stringify({ plan, method }) }),
  },
  bugReports: {
    create: (message: string, page: string) => request<{ id: string }>("/bug-reports", { method: "POST", body: JSON.stringify({ message, page }) }),
    list: (status?: string) => request<BugReport[]>(`/bug-reports${status ? `?status=${status}` : ""}`),
    setStatus: (id: string, status: string) => request<BugReport>(`/bug-reports/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  },
  usage: {
    report: (days: number) => request<UsageReport>(`/usage?days=${days}`),
    mine: () => request<{ plan: PlanInfo | null; limitUsd: number; monthUsd: number; since: string }>("/usage/me"),
  },
  assistant: {
    menu: () => request<{ items: MenuItem[] }>("/assistant/menu"),
    overview: () => request<{ routine: { total: number; today: { topic: string; when: string }[] }; memories: number }>("/assistant/overview"),
    setMenu: (hidden: string[]) => request<{ items: MenuItem[] }>("/assistant/menu", { method: "PUT", body: JSON.stringify({ hidden }) }),
  },
  notes: {
    list: () => request<{ notes: ListNote[] }>("/notes"),
    create: (data: { title: string; items?: NoteItem[]; remindAt?: string | null }) => request<ListNote>("/notes", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, patch: { title?: string; items?: NoteItem[]; remindAt?: string | null }) => request<ListNote>(`/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  users: {
    catalog: () => request<{ services: Record<string, string>; defaults: Record<string, string[]> }>("/users/services"),
    plans: () => request<{ plans: PlanInfo[] }>("/users/plans"),
    list: (status?: string) => request<any[]>(`/users${status ? `?status=${status}` : ""}`),
    create: (data: any) => request<any>("/users", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<any>(`/users/${id}`, { method: "DELETE" }),
  },
  automations: {
    list: () => request<any[]>("/automations"),
    create: (data: any) => request<any>("/automations", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/automations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    toggle: (id: string, isActive: boolean) =>
      request<any>(`/automations/${id}/toggle`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    remove: (id: string) => request<any>(`/automations/${id}`, { method: "DELETE" }),
  },
  inbox: {
    list: (status?: string) =>
      request<any[]>(`/inbox/conversations${status ? `?status=${status}` : ""}`),
    get: (id: string) =>
      request<any>(`/inbox/conversations/${id}`),
    updateStatus: (id: string, status: string) =>
      request<any>(`/inbox/conversations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    remove: (id: string, deleteContact = false) =>
      request<{ ok: boolean; contactDeleted: boolean }>(`/inbox/conversations/${id}${deleteContact ? "?deleteContact=true" : ""}`, { method: "DELETE" }),
  },
  contacts: {
    list: (search?: string) =>
      request<any[]>(`/contacts${search ? `?search=${search}` : ""}`),
    get: (id: string) => request<any>(`/contacts/${id}`),
    create: (data: any) => request<any>("/contacts", { method: "POST", body: JSON.stringify(data) }),
  },
  vault: {
    status: () => request<{ exists: boolean; unlocked: boolean; hasRecovery?: boolean; hasPin?: boolean; waLocked?: boolean; expiresAt?: number }>("/vault/status"),
    setup: (password: string) => request<{ recoveryKey: string }>("/vault/setup", { method: "POST", body: JSON.stringify({ password }) }),
    requestReset: () => request<{ sentTo: string; expiresMinutes: number }>("/vault/recovery/request", { method: "POST" }),
    recover: (token: string, recoveryKey: string, newPassword: string) =>
      request<{ recoveryKey: string }>("/vault/recovery/complete", { method: "POST", body: JSON.stringify({ token, recoveryKey, newPassword }) }),
    resetEmpty: (token: string, confirm: string, newPassword: string) =>
      request<{ recoveryKey: string }>("/vault/recovery/reset", { method: "POST", body: JSON.stringify({ token, confirm, newPassword }) }),
    newRecoveryKey: (password: string) => request<{ recoveryKey: string }>("/vault/recovery-key", { method: "POST", body: JSON.stringify({ password }) }),
    unlock: (password: string, minutes: number) =>
      request<any>("/vault/unlock", { method: "POST", body: JSON.stringify({ password, minutes }) }),
    setPin: (password: string, pin: string) => request<any>("/vault/pin", { method: "POST", body: JSON.stringify({ password, pin }) }),
    lock: () => request<any>("/vault/lock", { method: "POST" }),
    list: () => request<any[]>("/vault/entries"),
    reveal: (id: string) => request<any>(`/vault/entries/${id}`),
    create: (data: any) => request<{ id: string }>("/vault/entries", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<{ id: string }>(`/vault/entries/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: string) => request<any>(`/vault/entries/${id}`, { method: "DELETE" }),
    verify: () => request<{ ok: boolean; blocks: number; problem?: string; unreadable: number }>("/vault/verify", { method: "POST" }),
    changeMaster: (oldPassword: string, newPassword: string) =>
      request<any>("/vault/change-master", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) }),
  },
  spotify: {
    status: () => request<{ configured: boolean; connected: boolean; name?: string; premium?: boolean }>("/integrations/spotify/status"),
    authUrl: () => request<{ url: string }>("/integrations/spotify/auth-url"),
    disconnect: () => request<{ connected: boolean }>("/integrations/spotify", { method: "DELETE" }),
  },
  google: {
    authUrl: () => request<{ url: string; connected: boolean }>("/integrations/google/auth-url"),
  },
  apiKeys: {
    scopes: () => request<string[]>("/api-keys/scopes"),
    list: () => request<any[]>("/api-keys"),
    create: (data: { name: string; scopes: string[]; expiresAt?: string }) =>
      request<any>("/api-keys", { method: "POST", body: JSON.stringify(data) }),
    revoke: (id: string) => request<any>(`/api-keys/${id}`, { method: "DELETE" }),
  },
  webhooks: {
    events: () => request<string[]>("/webhooks/events"),
    list: () => request<any[]>("/webhooks"),
    create: (data: { url: string; events: string[] }) =>
      request<any>("/webhooks", { method: "POST", body: JSON.stringify(data) }),
    remove: (id: string) => request<any>(`/webhooks/${id}`, { method: "DELETE" }),
    test: (id: string) => request<any>(`/webhooks/${id}/test`, { method: "POST" }),
    deliveries: (id: string) => request<{ data: any[] }>(`/webhooks/${id}/deliveries`),
    retry: (id: string, deliveryId: string) =>
      request<any>(`/webhooks/${id}/deliveries/${deliveryId}/retry`, { method: "POST" }),
  },
  channels: {
    list: () => request<any[]>("/channels"),
    createWhatsapp: (name: string) =>
      request<any>("/channels/whatsapp", { method: "POST", body: JSON.stringify({ name }) }),
    whatsappQr: (channelId: string) =>
      request<any>(`/channels/whatsapp/${channelId}/qrcode`),
    whatsappStatus: (channelId: string) =>
      request<any>(`/channels/whatsapp/${channelId}/status`),
    deleteWhatsapp: (channelId: string) =>
      request<any>(`/channels/whatsapp/${channelId}`, { method: "DELETE" }),
    instagramAuthUrl: () => request<{ url: string }>("/channels/instagram/auth-url"),
    disconnectInstagram: (channelId: string) =>
      request<any>(`/channels/instagram/${channelId}`, { method: "DELETE" }),
    sendInstagram: (channelId: string, text: string, conversationId: string) =>
      request<any>(`/channels/instagram/${channelId}/send`, {
        method: "POST",
        body: JSON.stringify({ text, conversationId }),
      }),
    sendWhatsapp: (channelId: string, to: string, text: string, conversationId: string) =>
      request<any>(`/channels/whatsapp/${channelId}/send`, {
        method: "POST",
        body: JSON.stringify({ to, text, conversationId }),
      }),
  },
};
