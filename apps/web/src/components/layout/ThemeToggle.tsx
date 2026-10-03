"use client";

import { useEffect, useState } from "react";

const KEY = "oc_theme";

const read = () => { try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; } };

/** Modo dia/noite do painel. A classe `light` fica no <html> só enquanto o painel está aberto; ao sair, volta ao escuro. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const t = read();
    setTheme(t);
    document.documentElement.classList.toggle("light", t === "light");
    return () => document.documentElement.classList.remove("light");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    try { localStorage.setItem(KEY, next); } catch {}
  }

  const day = theme === "light";
  return (
    <button onClick={toggle} aria-label={day ? "Mudar para o modo noite" : "Mudar para o modo dia"} title={day ? "Modo noite" : "Modo dia"}
      className="p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800">
      {day ? (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      )}
    </button>
  );
}
