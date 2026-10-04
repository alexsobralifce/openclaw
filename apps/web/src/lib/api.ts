const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Item do menu principal do WhatsApp; `hidden` = fora da lista, `locked` = sempre visível. */
export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  hidden: boolean;
  locked: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("oc_token") : null;
  const res = await fetch(`${API}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("oc_token");
    document.cookie = "oc_token=; path=/; max-age=0";
    window.location.href = "/auth/login";
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Conta desativada ou pendente: encerra a sessão e mostra o motivo no login
    if (res.status === 403 && err.code === "ACCOUNT_INACTIVE" && typeof window !== "undefined") {
      localStorage.removeItem("oc_token");
      localStorage.removeItem("oc_user");
      document.cookie = "oc_token=; path=/; max-age=0";
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

export interface NoteTopic {
  id: string;
  name: string;
  notes: { id: string; name: string; modified?: string }[];
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
    /** Baixa na hora, do Drive do usuário. Arquivo grande demais: o erro traz o link do Drive em `link`. */
    download: async (id: string): Promise<Blob> => {
      const res = await fetch(`${API}/api/v1/documents/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Bearer ${localStorage.getItem("oc_token") ?? ""}` } });
      if (!res.ok) {
        const err: any = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.message || "Não consegui baixar o documento."), { link: typeof err.link === "string" ? err.link : null });
      }
      return res.blob();
    },
  },
  appChat: {
    messages: (after?: string) => request<ChatMessage[]>(`/app-chat/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`),
    send: (text: string) => request<ChatMessage>("/app-chat/messages", { method: "POST", body: JSON.stringify({ text }) }),
    sendAudio: (body: { base64: string; mime: string; seconds: number }) => request<ChatMessage>("/app-chat/audio", { method: "POST", body: JSON.stringify(body) }),
    sendFile: (body: { base64: string; mime: string; name: string; caption?: string }) => request<ChatMessage>("/app-chat/file", { method: "POST", body: JSON.stringify(body) }),
    setChannel: (channel: "whatsapp" | "app" | "telegram") => request<{ channel: string }>("/app-chat/channel", { method: "PUT", body: JSON.stringify({ channel }) }),
    pushStatus: () => request<{ enabled: boolean; publicKey: string; subscribed: boolean }>("/app-chat/push"),
    pushSubscribe: (sub: unknown) => request<any>("/app-chat/push", { method: "POST", body: JSON.stringify(sub) }),
    pushUnsubscribe: (endpoint: string) => request<any>("/app-chat/push", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
    /** Baixa um arquivo da lista do Drive, direto da conta do usuário. Se for grande demais, o erro traz o link do Drive em `link`. */
    driveFile: async (id: string, account: string): Promise<Blob> => {
      const res = await fetch(`${API}/api/v1/app-chat/drive/${encodeURIComponent(id)}?account=${encodeURIComponent(account)}`, { headers: { Authorization: `Bearer ${localStorage.getItem("oc_token") ?? ""}` } });
      if (!res.ok) {
        const err: any = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.message || "Não consegui baixar o arquivo."), { link: typeof err.link === "string" ? err.link : null });
      }
      return res.blob();
    },
    /** Baixa um arquivo enviado pelo assistente (precisa do token, então não dá para usar um link direto). */
    file: async (id: string): Promise<Blob> => {
      const res = await fetch(`${API}/api/v1/app-chat/files/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("oc_token") ?? ""}` } });
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
  usage: {
    report: (days: number) => request<UsageReport>(`/usage?days=${days}`),
    mine: () => request<{ plan: PlanInfo | null; limitUsd: number; monthUsd: number; since: string }>("/usage/me"),
  },
  assistant: {
    menu: () => request<{ items: MenuItem[] }>("/assistant/menu"),
    overview: () => request<{ routine: { total: number; today: { topic: string; when: string }[] }; memories: number }>("/assistant/overview"),
    notes: () => request<{ account: string; topics: NoteTopic[] }>("/assistant/notes"),
    note: (id: string) => request<{ name: string; topic: string; content: string; link?: string }>(`/assistant/notes/${encodeURIComponent(id)}`),
    createNote: (data: { topic: string; title?: string; content: string }) =>
      request<{ assunto: string; nome: string }>("/assistant/notes", { method: "POST", body: JSON.stringify(data) }),
    setMenu: (hidden: string[]) => request<{ items: MenuItem[] }>("/assistant/menu", { method: "PUT", body: JSON.stringify({ hidden }) }),
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
