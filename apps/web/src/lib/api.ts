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

export const api = {
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
