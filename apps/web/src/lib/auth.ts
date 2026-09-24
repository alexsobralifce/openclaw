"use client";

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  role: string | null;
}

export function getToken(): string | null {
  try { return localStorage.getItem("oc_token"); } catch { return null; }
}

export function setToken(token: string) {
  try {
    localStorage.setItem("oc_token", token);
    document.cookie = `oc_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  } catch {}
}

export function clearToken() {
  try {
    localStorage.removeItem("oc_token");
    localStorage.removeItem("oc_user");
    document.cookie = "oc_token=; path=/; max-age=0";
  } catch {}
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
  return !!getToken();
}
