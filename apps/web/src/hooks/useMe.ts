"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getUser, setUser, type UserInfo } from "@/lib/auth";

/** Usuário logado, com serviços liberados; começa pelo cache local e atualiza pela API. */
export function useMe() {
  const [me, setMe] = useState<UserInfo | null>(null);
  useEffect(() => {
    setMe(getUser());
    api.auth
      .me()
      .then((u) => {
        setUser(u);
        setMe(u);
      })
      .catch(() => {});
  }, []);
  return me;
}

export const isAdmin = (me: UserInfo | null) => me?.platformRole === "ROOT" || me?.platformRole === "ADMIN";
export const hasService = (me: UserInfo | null, s: string) => !!me?.services?.includes(s);
