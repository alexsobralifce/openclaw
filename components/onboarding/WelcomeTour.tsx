"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, setUser } from "@/lib/auth";

/** Evento que a página de Ajuda dispara para reabrir o tour. */
export const TOUR_EVENT = "magobox:tour";

interface Step {
  id: string;
  title: string;
  text: string;
  alt: string;
  /** Botão do último passo */
  cta?: { label: string; href: string };
}

// Os prints ficam em public/onboarding/<id>-desktop.webp e -mobile.webp (gerados por `pnpm prints:onboarding`)
const STEPS: Step[] = [
  { id: "boas-vindas", title: "Bem-vindo ao MagoBox", text: "Sua secretária particular: cuida dos seus e-mails, da agenda, dos documentos, das notas e das senhas. Vamos conhecer o essencial em 1 minuto.", alt: "Tela de resumo do MagoBox" },
  { id: "menus", title: "Os menus", text: "Pelo menu você vai ao Assistente, Resumo, Notas, Documentos, Canais, Cofre e Configurações. No celular, toque no ☰ no alto da tela.", alt: "Menu lateral do MagoBox com as opções do painel" },
  { id: "assistente", title: "Fale com o Assistente", text: "Digite, escolha um número do menu ou mande um áudio. Responder e-mails e criar eventos por voz é aqui. Dá para usar pelo app ou pelo WhatsApp.", alt: "Conversa com o Assistente no app" },
  { id: "assinar", title: "Como assinar", text: "Vá em Config. › Assinatura, escolha o plano e pague com cartão ou Pix. Assim que o pagamento confirma, o assistente e os menus são liberados.", alt: "Card de Assinatura em Configurações com os planos" },
  { id: "google", title: "Conecte o seu Google", text: "Em Canais, toque em “Conectar Google” e autorize Gmail, Agenda e Drive na tela do próprio Google. Você pode revogar quando quiser.", alt: "Card Conectar Google na tela de Canais" },
  { id: "cofre-senha", title: "Cofre: crie a senha mestra", text: "No Cofre, crie uma senha mestra só sua e guarde a chave de recuperação. Ela não pode ser recuperada por ninguém, nem por nós.", alt: "Formulário para criar a senha mestra do Cofre" },
  { id: "cofre-salvar", title: "Cofre: salve uma senha", text: "Com o cofre aberto, toque em adicionar, preencha o nome do site, o usuário e a senha e salve. Ela fica cifrada e só aparece com a senha mestra.", alt: "Lista de senhas salvas no Cofre" },
  { id: "documentos", title: "Documentos e notas", text: "Mande um PDF e ele vai para o seu Drive com categoria e tags. Em Notas, anote lembretes rápidos por assunto.", alt: "Tela de Documentos organizados por categoria" },
  { id: "pronto", title: "Tudo pronto!", text: "O próximo passo é escolher o seu plano para liberar o assistente. Você pode rever este tour a qualquer momento em Ajuda.", alt: "Planos disponíveis para assinar", cta: { label: "Escolher meu plano", href: "/dashboard/settings" } },
];

const src = (id: string, kind: "desktop" | "mobile") => `/onboarding/${id}-${kind}.webp`;

export function WelcomeTour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const nextRef = useRef<HTMLButtonElement>(null);
  const first = useRef(false); // abriu sozinho (1ª entrada): ao fechar, marca como visto no servidor

  // 1ª entrada: o servidor diz se este cadastro ainda não viu o tour
  useEffect(() => {
    api.auth.me().then((me) => {
      if (me?.onboarding) {
        first.current = true;
        setOpen(true);
      }
    }).catch(() => undefined);
  }, []);

  // Reabrir pela Ajuda
  useEffect(() => {
    const reopen = () => { setI(0); setOpen(true); };
    window.addEventListener(TOUR_EVENT, reopen);
    return () => window.removeEventListener(TOUR_EVENT, reopen);
  }, []);

  const close = useCallback((goTo?: string) => {
    setOpen(false);
    if (first.current) {
      first.current = false;
      api.auth.onboardingDone().catch(() => undefined);
      const u = getUser();
      if (u) setUser({ ...u, onboarding: false });
    }
    if (goTo) router.push(goTo);
  }, [router]);

  const last = i === STEPS.length - 1;
  const go = useCallback((d: number) => setI((cur) => Math.min(STEPS.length - 1, Math.max(0, cur + d))), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  useEffect(() => { if (open) nextRef.current?.focus(); }, [open, i]);

  if (!open) return null;
  const step = STEPS[i];
  const next = STEPS[i + 1];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="tour-titulo" className="w-full sm:max-w-2xl max-h-[96dvh] overflow-y-auto bg-gray-900 border border-gray-800 sm:rounded-2xl rounded-t-2xl p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">Passo {i + 1} de {STEPS.length}</p>
          <button type="button" onClick={() => close()} className="text-xs text-gray-400 hover:text-gray-200 underline underline-offset-2">Pular</button>
        </div>

        {!broken[step.id] && (
          <picture>
            <source media="(max-width: 767px)" srcSet={src(step.id, "mobile")} />
            <img
              key={step.id}
              src={src(step.id, "desktop")}
              alt={step.alt}
              width={1280}
              height={800}
              onError={() => setBroken((b) => ({ ...b, [step.id]: true }))}
              className="w-full h-auto max-h-[46dvh] object-contain rounded-xl border border-gray-800 bg-gray-950"
            />
          </picture>
        )}
        {/* pré-carrega o print do próximo passo */}
        {next && <link rel="prefetch" as="image" href={src(next.id, "desktop")} />}

        <div className="space-y-1.5">
          <h2 id="tour-titulo" className="text-lg font-semibold text-gray-100">{step.title}</h2>
          <p className="text-sm leading-relaxed text-gray-400">{step.text}</p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((s, n) => (
              <span key={s.id} className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-violet-400" : "w-1.5 bg-gray-700"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => go(-1)} disabled={i === 0} className="px-4 py-2 rounded-lg text-sm bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30">Voltar</button>
            {last ? (
              <>
                <button type="button" onClick={() => close()} className="px-4 py-2 rounded-lg text-sm bg-gray-800 text-gray-300 hover:bg-gray-700">Explorar sozinho</button>
                <button ref={nextRef} type="button" onClick={() => close(step.cta?.href)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-500">{step.cta?.label ?? "Concluir"}</button>
              </>
            ) : (
              <button ref={nextRef} type="button" onClick={() => go(1)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-500">Avançar</button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
