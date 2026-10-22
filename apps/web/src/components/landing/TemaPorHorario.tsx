"use client";

import { useEffect } from "react";

// Dia das 6h às 18h (hora do aparelho), noite no resto. O script inline da página já define o tema antes da primeira pintura;
// aqui só se corrige depois da hidratação e se troca sozinho quando a hora vira, sem recarregar.
const tema = () => {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "dia" : "noite";
};

export function TemaPorHorario() {
  useEffect(() => {
    const aplicar = () => {
      const raiz = document.querySelector<HTMLElement>(".landing");
      if (raiz) raiz.dataset.tema = tema();
    };
    aplicar();
    const id = setInterval(aplicar, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
