"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearToken, getUser, UserInfo } from "@/lib/auth";
import { LogoMark } from "@/components/brand/Logo";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export function TopBar() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function logout() {
    clearToken();
    router.push("/auth/login");
  }

  return (
    <header className="flex items-center justify-end gap-2 px-3 md:px-6 h-[calc(3.5rem_+_env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] md:h-14 md:pt-0 border-b border-gray-800 bg-gray-900 flex-shrink-0">
      {/* No celular a barra lateral não existe: a marca fica aqui */}
      <span className="md:hidden flex-shrink-0"><LogoMark size={30} /></span>
      {/* Workspace pill */}
      {user?.workspaceName && (
        <div className="mr-auto min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700">
          <div className="w-5 h-5 rounded bg-violet-500 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
            {user.workspaceName[0].toUpperCase()}
          </div>
          <span className="text-xs font-medium text-gray-300 truncate">{user.workspaceName}</span>
          <span className="hidden sm:inline text-[10px] text-gray-600 capitalize">{user.role?.toLowerCase()}</span>
        </div>
      )}

      {/* Right side */}
      <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
        {/* Notifications (placeholder) */}
        <button className="relative p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Avatar dropdown */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-xl hover:bg-gray-800 transition-colors"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover ring-2 ring-gray-700" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold text-white ring-2 ring-gray-700">
                {user ? initials(user.name) : "?"}
              </div>
            )}
            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold text-gray-200 leading-none">{user?.name ?? "..."}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 truncate max-w-[140px]">{user?.email ?? ""}</p>
            </div>
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" className="text-gray-500 flex-shrink-0">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-sm font-medium text-gray-200">{user?.name}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{user?.email}</p>
              </div>

              <button
                onClick={() => { setOpen(false); router.push("/dashboard/settings"); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                Minha conta
              </button>

              <div className="border-t border-gray-800 mt-1 pt-1">
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Sair da conta
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
