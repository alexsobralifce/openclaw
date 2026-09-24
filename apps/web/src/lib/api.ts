const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ accessToken: string; user: any }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (data: { email: string; name: string; password: string; workspaceName: string }) =>
      request<{ accessToken: string; user: any }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    me: () => request<any>("/auth/me"),
  },
  inbox: {
    list: (status?: string) =>
      request<any[]>(`/inbox/conversations${status ? `?status=${status}` : ""}`),
    get: (id: string) =>
      request<any>(`/inbox/conversations/${id}`),
    updateStatus: (id: string, status: string) =>
      request<any>(`/inbox/conversations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  },
  contacts: {
    list: (search?: string) =>
      request<any[]>(`/contacts${search ? `?search=${search}` : ""}`),
    get: (id: string) => request<any>(`/contacts/${id}`),
    create: (data: any) => request<any>("/contacts", { method: "POST", body: JSON.stringify(data) }),
  },
  google: {
    authUrl: () => request<{ url: string; connected: boolean }>("/integrations/google/auth-url"),
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
    sendWhatsapp: (channelId: string, to: string, text: string, conversationId: string) =>
      request<any>(`/channels/whatsapp/${channelId}/send`, {
        method: "POST",
        body: JSON.stringify({ to, text, conversationId }),
      }),
  },
};
