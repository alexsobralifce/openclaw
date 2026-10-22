"use client";

import { useEffect } from "react";

/**
 * Claro ou escuro conforme o celular (ou o computador) está configurado, inclusive o modo automático por horário: sem botão.
 * A classe `light` fica no <html> só enquanto o painel está aberto; landing e login ficam sempre escuros.
 */
export function ThemeSync() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => document.documentElement.classList.toggle("light", query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      document.documentElement.classList.remove("light");
    };
  }, []);
  return null;
}
