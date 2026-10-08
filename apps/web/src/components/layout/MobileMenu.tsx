"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { endSession } from "@/lib/auth";
import { useMe } from "@/hooks/useMe";
import { BugReportButton } from "./BugReportButton";
import { visibleNav } from "./Sidebar";

const rowClass = "flex items-center gap-3 px-5 min-h-12 text-[15px] text-gray-300 active:bg-gray-800";

/** Menu sanduíche do celular: botão no cabeçalho e gaveta pela esquerda com todas as telas. A partir de 768 px entra a barra lateral. */
export function MobileMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const [open, setOpen] = useState(false);

  // O que é de administração (API, usuários, consumo) fica só no computador
  const items = visibleNav(me).filter((i) => !i.desktopOnly);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function logout() {
    endSession();
    router.push("/");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="md:hidden flex-shrink-0 w-10 h-10 -ml-1 flex items-center justify-center rounded-full text-gray-300 active:bg-gray-800"
      >
        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 w-[80%] max-w-xs flex flex-col overflow-y-auto border-r border-gray-800 bg-gray-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-800">
              <p className="text-sm font-semibold text-gray-200 truncate">{me?.workspaceName ?? "Meu Workspace"}</p>
              <p className="text-xs text-gray-500 truncate">{me?.name}{me?.email ? ` · ${me.email}` : ""}</p>
            </div>
            <nav aria-label="Menu" className="flex-1">
              {items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`${rowClass} ${active ? "text-violet-400 bg-gray-800/60" : ""}`}>
                    <span className={active ? "text-violet-400" : "text-gray-500"}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
              <BugReportButton className={`${rowClass} w-full text-gray-300`} />
              <button onClick={logout} className={`${rowClass} w-full text-red-400`}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Sair
              </button>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
