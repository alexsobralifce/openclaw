"use client";

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  role: string | null;
  phone?: string | null;
  /** ROOT | ADMIN | USER */
  platformRole?: string;
  services?: string[];
  /** whatsapp | app | telegram */
  assistantChannel?: string;
  /** Cadastro novo que ainda não viu o tour de boas-vindas */
  onboarding?: boolean;
}

/** Marca de "Agora não" do aviso de instalação; cada login a apaga para o aviso voltar. */
export const PWA_DISMISS_KEY = "oc_pwa_dismissed";

// O token da sessão vive só num cookie HttpOnly gravado pela API: o JavaScript do painel não o enxerga.
// Aqui fica apenas um sinal "tem sessão" (sem segredo), que o middleware usa para decidir entre painel e login;
// quem de fato valida a sessão é a API.
const FLAG = "oc_auth";
/** Mesma validade da sessão na API (ela é renovada com o uso). */
export const SESSION_DAYS = 180;

/** Restos do esquema antigo, em que o token ficava no localStorage e num cookie legível. */
function dropLegacyToken() {
  try {
    localStorage.removeItem("oc_token");
    document.cookie = "oc_token=; path=/; max-age=0";
  } catch {}
}
if (typeof window !== "undefined") dropLegacyToken();

/** Chamar depois de um login bem-sucedido (a API já gravou o cookie da sessão). */
export function startSession() {
  try {
    localStorage.removeItem(PWA_DISMISS_KEY);
    document.cookie = `${FLAG}=1; path=/; max-age=${SESSION_DAYS * 24 * 3600}; SameSite=Lax`;
  } catch {}
}

/** Limpa o estado local e manda a API apagar o cookie HttpOnly (só o servidor consegue). */
export function endSession() {
  try {
    localStorage.removeItem("oc_user");
    document.cookie = `${FLAG}=; path=/; max-age=0`;
  } catch {}
  dropLegacyToken();
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  return fetch(`${api}/api/v1/auth/logout`, { method: "POST", credentials: "include", keepalive: true }).catch(() => undefined);
}

export function setUser(user: UserInfo) {
  try { localStorage.setItem("oc_user", JSON.stringify(user)); } catch {}
}

export function getUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem("oc_user");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function isAuthenticated(): boolean {
  try { return document.cookie.split("; ").some((c) => c === `${FLAG}=1`); } catch { return false; }
}
