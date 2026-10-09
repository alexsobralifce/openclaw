import Link from "next/link";
import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { Logo } from "@/components/brand/Logo";
import { TemaPorHorario } from "@/components/landing/TemaPorHorario";
import { UmamiRecorder } from "@/components/landing/umami-recorder";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["500", "700", "800"] });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "MagoBox: secretária virtual para e-mail, agenda e senhas",
  description:
    "Secretária particular no app ou no WhatsApp: organiza documentos, notas, senhas e compromissos e responde e-mails e cria eventos por voz. 7 dias grátis.",
  // Um só endereço para o Google (o mesmo site responde em app. e www.)
  alternates: { canonical: "/" },
};

const TEAL = "text-[color:var(--l-accent)]";
const H = "font-[family-name:var(--font-display)]";

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM19 11a7 7 0 0 1-14 0M12 18v3",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  cal: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z M9 12l2 2 4-4",
  check: "m5 12 5 5L20 7",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  grid: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  note: "M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 21v-4a2 2 0 0 1 2-2h4M8 8h8M8 12h5",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 7l9 6 9-6",
  event: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM12 13v5M9.5 15.5h5",
  phone: "M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM11 18h2",
};

const BENEFITS = [
  { icon: ICONS.doc, title: "Documentos em categorias", text: "Mande um PDF e ele vai para o seu Google Drive com título, categoria e tags sugeridas pela IA. Depois é só pedir pelo assunto." },
  { icon: ICONS.note, title: "Notas rápidas e lembretes", text: "Anote em segundos, por assunto, e deixe lembretes salvos para não esquecer o que importa." },
  { icon: ICONS.lock, title: "Senhas guardadas com segurança", text: "Um cofre protegido por senha mestra, só seu (nos planos Mago e Arquimago)." },
  { icon: ICONS.cal, title: "Compromissos sob controle", text: "Veja a agenda de hoje e organize seus compromissos no Google Agenda, com até 10 contas Google conforme o plano." },
  { icon: ICONS.mail, title: "Responda e-mails por voz", text: "Chegou um e-mail? Diga o que responder e o assistente escreve o rascunho. Só envia depois do seu OK." },
  { icon: ICONS.event, title: "Crie eventos por voz", text: "Fale “reunião na quinta às 15h” e o evento entra na sua agenda, sem abrir formulário." },
  { icon: ICONS.phone, title: "No app ou no WhatsApp", text: "Use no app do MagoBox ou converse com o assistente no WhatsApp. Por texto, áudio ou com um número do menu." },
  { icon: ICONS.bell, title: "Aviso de e-mail na hora", text: "Você recebe quem mandou e decide em um toque: ler, apagar ou responder." },
  { icon: ICONS.shield, title: "Você no controle", text: "Nada é enviado sem o seu “1 - Confirmar”. E-mails com truques para enganar a IA são sinalizados." },
];

// Planos mostrados na landing. Mantenha iguais aos de apps/api/src/modules/auth/plans.ts (preços e limites de contas, PDF e áudio).
const PLANS = [
  { name: "Aprendiz", who: "Para experimentar e uso leve", price: "9,90", tag: "", features: ["Assistente por texto e por áudio no WhatsApp", "E-mail, agenda, notas, Drive e contatos", "1 conta Google", "PDF até 15 páginas e áudio até 1 minuto", "Uso leve de IA por mês"] },
  { name: "Mago", who: "Para o uso diário", price: "29,90", tag: "Para o dia a dia", features: ["Tudo do Aprendiz", "Rotina, memória e cofre de senhas", "Até 3 contas Google", "PDF até 50 páginas e áudio até 3 minutos", "Uso diário de IA"] },
  { name: "Arquimago", who: "Para uso intenso e em escala", price: "69,90", tag: "", features: ["Tudo do Mago", "Painel de conversas de clientes em tempo real", "API, webhooks e automações", "Até 10 contas Google", "PDF até 80 páginas e áudio até 5 minutos", "Uso intenso de IA"] },
];

const FAQ = [
  ["Preciso usar o WhatsApp?", "Não. Você pode usar o MagoBox pelo app ou conversar com o assistente no WhatsApp, o que for mais prático. Para o WhatsApp, você conecta o número lendo um QR Code, como no WhatsApp Web."],
  ["Meus e-mails ficam seguros?", "Você autoriza o acesso pela tela do próprio Google e pode revogar quando quiser nas configurações da sua conta. O assistente nunca envia nada sem a sua confirmação."],
  ["Como funcionam os 7 dias grátis?", "Você testa sem pagar e, depois, escolhe um plano: Aprendiz (R$ 9,90), Mago (R$ 29,90) ou Arquimago (R$ 69,90) por mês. Se cancelar antes do fim do teste, não paga nada. O teste tem um limite de uso de IA menor que o dos planos."],
  ["E se eu usar muito a IA?", "Cada plano tem um limite mensal de uso de IA. Ao chegar nele, o menu do assistente continua funcionando e a IA (respostas livres, áudio e leitura de arquivos) volta no mês seguinte. Em Configurações você acompanha quanto já usou."],
  ["Onde ficam os PDFs que eu mando?", "No seu próprio Google Drive. O MagoBox guarda só a ficha de cada documento (título, categoria, tags e resumo) para você achar rápido. Ao apagar um documento, o PDF vai para a lixeira do Drive."],
  ["A IA responde meus e-mails sozinha?", "Não. Ela escreve o rascunho a partir do que você diz em poucas palavras, por texto ou voz, e só envia depois do seu OK."],
  ["Meus compromissos ficam em qual agenda?", "No seu Google Agenda. Você pede por texto ou por voz e o evento é criado na conta Google que você conectou."],
];

function wa(text: string) {
  return text.split(/\*(.+?)\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-white">{part}</strong> : part));
}

function Bubble({ from, children }: { from: "me" | "bot"; children: string }) {
  const me = from === "me";
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-sm ${
          me ? "rounded-br-sm bg-[#005c4b] text-white" : "rounded-bl-sm bg-[#202c33] text-[#e9edef]"
        }`}
      >
        {wa(children)}
      </div>
    </div>
  );
}

function Phone({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[2.2rem] border border-white/10 bg-[#0b141a] p-2 shadow-[0_30px_80px_-20px_rgba(167,139,250,0.25)]">
      <div className="overflow-hidden rounded-[1.7rem] bg-[#0b141a]">
        <div className="flex items-center gap-2 bg-[#202c33] px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[#A78BFA] text-sm font-bold text-[#1E1B4B]">o</div>
          <div>
            <p className="text-[13px] font-semibold text-white">{label}</p>
            <p className="text-[11px] text-[#8696a0]">online</p>
          </div>
        </div>
        <div className="space-y-2 bg-[#0b141a] px-3 py-4">{children}</div>
      </div>
    </div>
  );
}

// Dados estruturados da página inicial: só o que está visível nela (nome, descrição e o "a partir de R$ 9,90/mês").
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.magobox.com.br").replace(/\/$/, "");
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "MagoBox", url: SITE, logo: `${SITE}/brand/magobox-icon-1024.png` },
    { "@type": "WebSite", "@id": `${SITE}/#site`, url: SITE, name: "MagoBox", inLanguage: "pt-BR", publisher: { "@id": `${SITE}/#org` } },
    {
      "@type": "SoftwareApplication",
      name: "MagoBox",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, WhatsApp",
      inLanguage: "pt-BR",
      description: "Secretária particular no app ou no WhatsApp: organiza documentos, notas, senhas e compromissos e responde e-mails e cria eventos por voz.",
      featureList: BENEFITS.map((b) => b.title),
      url: SITE,
      publisher: { "@id": `${SITE}/#org` },
      offers: { "@type": "AggregateOffer", lowPrice: "9.90", highPrice: "69.90", priceCurrency: "BRL", offerCount: PLANS.length },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
  ],
};

// Tema por horário (hora local de quem visita): dia das 6h às 18h, noite no resto. Roda antes da primeira pintura, para não piscar.
const TEMA_SCRIPT = "try{var h=new Date().getHours();document.currentScript.parentElement.dataset.tema=h>=6&&h<18?'dia':'noite'}catch(e){}";

export default function Landing() {
  return (
    <div suppressHydrationWarning data-tema="noite" className={`${display.variable} ${body.variable} landing min-h-screen bg-[color:var(--l-bg)] font-[family-name:var(--font-body)] text-[color:var(--l-text)] antialiased`}>
      <UmamiRecorder />
      <script dangerouslySetInnerHTML={{ __html: TEMA_SCRIPT }} />
      <TemaPorHorario />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-[color:var(--l-line-soft)] bg-[color:var(--l-bg-glass)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="MagoBox — início"><Logo size={36} textClassName={`${H} text-xl font-bold tracking-tight text-[color:var(--l-strong)]`} /></Link>
          <nav className="hidden items-center gap-8 text-sm text-[color:var(--l-muted)] md:flex">
            <a href="#vantagens" className="hover:text-[color:var(--l-strong)]">Vantagens</a>
            <a href="#como" className="hover:text-[color:var(--l-strong)]">Como funciona</a>
            <a href="#preco" className="hover:text-[color:var(--l-strong)]">Preço</a>
            <a href="#duvidas" className="hover:text-[color:var(--l-strong)]">Dúvidas</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="hidden text-sm text-[color:var(--l-muted)] hover:text-[color:var(--l-strong)] sm:block">Entrar</Link>
            <Link href="/auth/register" className="rounded-lg bg-[#FBBF24] px-4 py-2 text-sm font-semibold text-[#2E1065] transition hover:bg-[#FDE68A]">
              Testar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[#A78BFA]/10 blur-[120px]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 md:grid-cols-[1.15fr_0.85fr] md:pb-28 md:pt-24">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[color:var(--l-line)] px-3 py-1 text-xs text-[color:var(--l-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A78BFA]" /> 7 dias grátis, depois a partir de R$ 9,90/mês
            </p>
            <h1 className={`${H} text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl`}>
              Sua <span className={TEAL}>secretária particular</span>, no app ou no WhatsApp.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--l-muted)]">
              Organiza seus documentos, anota lembretes, guarda suas senhas com segurança e cuida dos seus compromissos. Responda e-mails e crie eventos só falando.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/auth/register" className="rounded-xl bg-[#FBBF24] px-6 py-3.5 text-base font-semibold text-[#2E1065] transition hover:bg-[#FDE68A]">
                Começar 7 dias grátis
              </Link>
              <a href="#como" className="rounded-xl border border-[color:var(--l-line)] px-6 py-3.5 text-base font-medium text-[color:var(--l-strong)] transition hover:bg-[color:var(--l-hover)]">
                Ver como funciona
              </a>
            </div>
          </div>

          <Phone label="Assistente MagoBox">
            <Bubble from="me">oi</Bubble>
            <Bubble from="bot">{`🌤️ *Boa tarde! Sou o MagoBox*
O que vamos ver agora?
━━━━━━━━━━━━━━
1️⃣ 📧 E-mails
2️⃣ 📅 Google Agenda
3️⃣ 🤖 Perguntar à IA
4️⃣ 🧠 Minha memória
━━━━━━━━━━━━━━
💡 Responda com o número, escreva ou mande um áudio 🎙️`}</Bubble>
            <Bubble from="me">2</Bubble>
          </Phone>
        </div>
      </section>

      {/* Vantagens */}
      <section id="vantagens" className="border-t border-[color:var(--l-line-soft)] py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${TEAL}`}>Vantagens</p>
          <h2 className={`${H} mt-3 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>
            Tudo o que uma secretária particular faz por você.
          </h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <article key={b.title} className="rounded-2xl border border-[color:var(--l-line)] bg-[color:var(--l-card)] p-7 transition hover:-translate-y-0.5 hover:border-[#A78BFA]/50">
                <div className={`mb-4 grid h-10 w-10 place-items-center rounded-lg bg-[#A78BFA]/10 ${TEAL}`}>
                  <Icon d={b.icon} />
                </div>
                <h3 className={`${H} text-lg font-bold`}>{b.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--l-muted)]">{b.text}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 rounded-xl border border-[#A78BFA]/20 bg-[#A78BFA]/5 px-5 py-4 text-[15px] text-[color:var(--l-hl)]">
            <strong className="font-semibold">E ele aprende com você.</strong> Diga “lembre que respondo o João de forma informal” e os próximos rascunhos já saem no seu jeito.
          </p>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como" className="border-t border-[color:var(--l-line-soft)] py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 md:grid-cols-2">
          <div>
            <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${TEAL}`}>Como funciona</p>
            <h2 className={`${H} mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>
              Chegou um e-mail. Três toques e resolvido.
            </h2>
            <ol className="mt-10 space-y-7">
              {[
                ["Crie sua conta", "Entre pelo app ou conecte o WhatsApp lendo um QR Code. Leva menos de um minuto."],
                ["Conecte seu Google", "Autorize Gmail e Agenda pela tela do Google. Você revoga quando quiser."],
                ["Peça o que precisa", "Digite, escolha um número do menu ou mande um áudio. O assistente faz o resto."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className={`${H} grid h-9 w-9 flex-none place-items-center rounded-full border border-[#A78BFA]/40 text-sm font-bold ${TEAL}`}>{i + 1}</span>
                  <div>
                    <h3 className="font-semibold">{t}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-[color:var(--l-muted)]">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <Phone label="Assistente MagoBox">
            <Bubble from="bot">{`📩 *Novo e-mail*
━━━━━━━━━━━━━━
👤 *De:* Prefeitura Municipal
📌 *Assunto:* Convite para reunião
📥 *Conta:* voce@gmail.com
━━━━━━━━━━━━━━
1️⃣ 📖 Ler
2️⃣ 🗑️ Apagar
3️⃣ ↩️ Responder`}</Bubble>
            <Bubble from="me">3</Bubble>
            <Bubble from="bot">{`🎙️ *Responder e-mail*
Me diga por texto ou áudio o que responder, que eu escrevo o e-mail.`}</Bubble>
            <Bubble from="me">🎙️ 0:04</Bubble>
            <Bubble from="bot">{`✍️ *Rascunho da resposta*
Olá! Confirmo minha presença na reunião. Obrigado pelo convite.
━━━━━━━━━━━━━━
1️⃣ ✅ Enviar   2️⃣ 🔄 Refazer`}</Bubble>
          </Phone>
        </div>
      </section>

      {/* Preço */}
      <section id="preco" className="border-t border-[color:var(--l-line-soft)] py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${TEAL}`}>Preço</p>
            <h2 className={`${H} mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>Escolha o plano do seu tamanho</h2>
            <p className="mt-3 text-[15px] text-[color:var(--l-muted)]">Todos começam com 7 dias grátis. Sem fidelidade e sem pegadinha: o limite de uso de IA de cada plano está claro desde o começo.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={`flex flex-col rounded-3xl border p-8 ${p.tag ? "border-[#A78BFA]/50 bg-gradient-to-b from-[color:var(--l-card-hl)] to-[color:var(--l-card)] shadow-[0_30px_80px_-30px_rgba(167,139,250,0.35)]" : "border-[color:var(--l-line)] bg-[color:var(--l-card)]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`${H} text-xl font-bold`}>{p.name}</h3>
                  {p.tag && <span className="rounded-full bg-[#A78BFA]/15 px-3 py-1 text-xs font-semibold text-[color:var(--l-accent)]">{p.tag}</span>}
                </div>
                <p className="mt-1 text-sm text-[color:var(--l-muted)]">{p.who}</p>
                <p className="mt-6 flex items-end gap-1">
                  <span className="pb-1 text-lg text-[color:var(--l-muted)]">R$</span>
                  <span className={`${H} text-5xl font-extrabold leading-none tracking-tight`}>{p.price}</span>
                  <span className="pb-1 text-[color:var(--l-muted)]">/mês</span>
                </p>
                <ul className="mt-7 flex-1 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-3 text-[15px]">
                      <span className={`mt-0.5 ${TEAL}`}><Icon d={ICONS.check} /></span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/auth/register" className="mt-8 block rounded-xl bg-[#FBBF24] py-3.5 text-center text-base font-semibold text-[#2E1065] transition hover:bg-[#FDE68A]">
                  Começar 7 dias grátis
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-[color:var(--l-faint)]">Cancele antes do fim do teste e não paga nada. O teste tem um limite de uso de IA menor que o dos planos.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="duvidas" className="border-t border-[color:var(--l-line-soft)] py-20 md:py-28">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className={`${H} text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>Dúvidas comuns</h2>
          <div className="mt-10 divide-y divide-[color:var(--l-line)] border-y border-[color:var(--l-line)]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {q}
                  <span className={`text-xl transition group-open:rotate-45 ${TEAL}`}>+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--l-muted)]">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t border-[color:var(--l-line-soft)] py-20">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className={`${H} text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>
            Teste por 7 dias e veja quanto tempo você ganha.
          </h2>
          <Link href="/auth/register" className="mt-8 inline-block rounded-xl bg-[#FBBF24] px-8 py-4 text-base font-semibold text-[#2E1065] transition hover:bg-[#FDE68A]">
            Criar minha conta
          </Link>
        </div>
      </section>

      <footer className="border-t border-[color:var(--l-line-soft)] py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 text-sm text-[color:var(--l-faint)]">
          <Logo size={26} textClassName={`${H} text-base font-bold tracking-tight text-[color:var(--l-strong)]`} />
          <span>© 2026 MagoBox. Todos os direitos reservados.</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacidade" className="hover:text-[color:var(--l-strong)]">Política de Privacidade</Link>
            <Link href="/termos" className="hover:text-[color:var(--l-strong)]">Termos de Serviço</Link>
            <Link href="/exclusao-de-dados" className="hover:text-[color:var(--l-strong)]">Exclusão de dados</Link>
            <Link href="/auth/login" className="hover:text-[color:var(--l-strong)]">Entrar</Link>
            <Link href="/auth/register" className="hover:text-[color:var(--l-strong)]">Criar conta</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
