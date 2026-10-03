"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken } from "@/lib/auth";
import { useMe } from "@/hooks/useMe";
import { visibleNav } from "./Sidebar";

// Abas fixas da barra inferior (as que o usuário tiver liberadas, nesta ordem); o resto vai em "Mais".
const PRIMARY = ["/dashboard/inbox", "/dashboard/vault", "/dashboard/contacts", "/dashboard/channels"];

const rowClass = "flex items-center gap-3 px-5 min-h-12 text-[15px] text-gray-300 active:bg-gray-800";

/** Navegação do celular: barra inferior ao alcance do polegar. Some a partir de 768 px, onde entra a barra lateral. */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const [open, setOpen] = useState(false);

  const items = visibleNav(me);
  const tabs = PRIMARY.map((h) => items.find((i) => i.href === h)).filter((i): i is (typeof items)[number] => !!i).slice(0, 4);
  const rest = items.filter((i) => !tabs.includes(i));
  const moreActive = rest.some((i) => pathname.startsWith(i.href));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function logout() {
    clearToken();
    router.push("/auth/login");
  }

  return (
    <>
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Mais opções"
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-gray-800 bg-gray-900 pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-700" aria-hidden />
            <div className="px-5 py-3 border-b border-gray-800">
              <p className="text-sm font-semibold text-gray-200 truncate">{me?.workspaceName ?? "Meu Workspace"}</p>
              <p className="text-xs text-gray-500 truncate">{me?.name}{me?.email ? ` · ${me.email}` : ""}</p>
            </div>
            <nav aria-label="Mais opções">
              {rest.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={`${rowClass} ${active ? "text-violet-400" : ""}`}>
                    <span className={active ? "text-violet-400" : "text-gray-500"}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
              <a href="/comandos.html" target="_blank" rel="noopener" className={`${rowClass} border-t border-gray-800`}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" className="text-gray-500"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Guia de comandos
              </a>
              <a href="/api-publica.html" target="_blank" rel="noopener" className={rowClass}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" className="text-gray-500"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Documentação da API
              </a>
              <button onClick={logout} className={`${rowClass} w-full text-red-400`}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Sair
              </button>
            </nav>
          </div>
        </div>
      )}

      <nav aria-label="Navegação principal" className="md:hidden flex-shrink-0 z-30 flex border-t border-gray-800 bg-gray-900 pb-[env(safe-area-inset-bottom)]">
        {tabs.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] font-medium ${active ? "text-violet-400" : "text-gray-500 active:text-gray-300"}`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] font-medium ${moreActive || open ? "text-violet-400" : "text-gray-500 active:text-gray-300"}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
          Mais
        </button>
      </nav>
    </>
  );
}
