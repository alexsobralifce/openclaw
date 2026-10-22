"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { visibleNav } from "@/components/layout/Sidebar";
import { getUser } from "@/lib/auth";
import { useMe } from "@/hooks/useMe";

/** Tela inicial: o Assistente. Quem não tem o serviço liberado cai no primeiro item do menu a que tem acesso. */
export default function DashboardPage() {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    const who = me ?? getUser();
    const visible = visibleNav(who);
    const assistant = visible.find((i) => i.href === "/dashboard/chat");
    const first = assistant ?? visible.find((i) => !i.desktopOnly || window.matchMedia("(min-width: 768px)").matches);
    router.replace(first?.href ?? "/dashboard/settings");
  }, [me, router]);

  return <div className="p-6 text-sm text-gray-500">Abrindo…</div>;
}
