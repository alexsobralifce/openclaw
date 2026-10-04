import Link from "next/link";
import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { Logo } from "@/components/brand/Logo";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["500", "700", "800"] });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "MagoBox — sua secretária virtual no WhatsApp",
  description:
    "Um assistente no WhatsApp que avisa de cada e-mail, mostra sua agenda e cuida dos seus clientes. Você só digita um número ou manda um áudio. 7 dias grátis.",
  // Um só endereço para o Google (o mesmo site responde em app. e www.)
  alternates: { canonical: "/" },
};

const TEAL = "text-[#A78BFA]";
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
};

const BENEFITS = [
  { icon: ICONS.hash, title: "Comande tudo com números", text: "Mande “oi” e escolha: 1 e-mails, 2 agenda, 3 clientes. Sem textão e sem decorar comando." },
  { icon: ICONS.mic, title: "Fale por áudio", text: "Grave um áudio no WhatsApp. O assistente transcreve, entende e responde. Perfeito para quem está na rua." },
  { icon: ICONS.bell, title: "Aviso de e-mail na hora", text: "Chegou um e-mail? Você recebe quem mandou e decide em um toque: ler, apagar ou responder." },
  { icon: ICONS.cal, title: "Gmail e Google Agenda", text: "Conecte até duas contas Google, veja os compromissos de hoje e crie eventos falando do seu jeito." },
  { icon: ICONS.chat, title: "Clientes na mesma caixa", text: "As conversas dos clientes chegam num painel em tempo real. Responda pelo painel ou pelo próprio WhatsApp." },
  { icon: ICONS.doc, title: "PDFs organizados", text: "Mande um PDF e ele vai para o seu Google Drive com título, categoria e tags sugeridas pela IA. Depois é só pedir pelo assunto." },
  { icon: ICONS.grid, title: "Resumo do que você guarda", text: "Um painel com documentos, notas, contatos, rotina e o uso de IA do mês, no celular e no computador." },
  { icon: ICONS.lock, title: "Notas, rotina e cofre", text: "Anote por assunto, mantenha sua rotina e guarde senhas num cofre protegido por senha mestra (rotina e cofre nos planos Mago e Arquimago)." },
  { icon: ICONS.shield, title: "Você no controle", text: "Nada é enviado sem o seu “1 - Confirmar”. E-mails com truques para enganar a IA são sinalizados." },
];

// Planos mostrados na landing. Mantenha iguais aos de apps/api/src/modules/auth/plans.ts (preços e limites de contas, PDF e áudio).
const PLANS = [
  { name: "Aprendiz", who: "Para experimentar e uso leve", price: "9,90", tag: "", features: ["Assistente por texto e por áudio no WhatsApp", "E-mail, agenda, notas, Drive e contatos", "1 conta Google", "PDF até 15 páginas e áudio até 1 minuto", "Uso leve de IA por mês"] },
  { name: "Mago", who: "Para o uso diário", price: "29,90", tag: "Para o dia a dia", features: ["Tudo do Aprendiz", "Rotina, memória e cofre de senhas", "Até 3 contas Google", "PDF até 50 páginas e áudio até 3 minutos", "Uso diário de IA"] },
  { name: "Arquimago", who: "Para uso intenso e em escala", price: "69,90", tag: "", features: ["Tudo do Mago", "Painel de conversas de clientes em tempo real", "API, webhooks e automações", "Até 10 contas Google", "PDF até 80 páginas e áudio até 5 minutos", "Uso intenso de IA"] },
];

const FAQ = [
  ["Preciso de um número de WhatsApp novo?", "Você conecta o número lendo um QR Code, como no WhatsApp Web. Recomendamos um número dedicado ao atendimento. Os comandos ao assistente saem do seu número pessoal."],
  ["Meus e-mails ficam seguros?", "Você autoriza o acesso pela tela do próprio Google e pode revogar quando quiser nas configurações da sua conta. O assistente nunca envia nada sem a sua confirmação."],
  ["O que acontece depois dos 7 dias?", "Você escolhe um plano: Aprendiz (R$ 9,90), Mago (R$ 29,90) ou Arquimago (R$ 69,90) por mês. Se cancelar antes do fim do teste, não paga nada. O teste tem um limite de uso de IA menor que o dos planos."],
  ["E se eu usar muito a IA?", "Cada plano tem um limite mensal de uso de IA. Ao chegar nele, o menu do assistente continua funcionando e a IA (respostas livres, áudio e leitura de arquivos) volta no mês seguinte. Em Configurações você acompanha quanto já usou."],
  ["Onde ficam os PDFs que eu mando?", "No seu próprio Google Drive. O MagoBox guarda só a ficha de cada documento (título, categoria, tags e resumo) para você achar rápido. Ao apagar um documento, o PDF vai para a lixeira do Drive."],
  ["A IA responde meus clientes sozinha?", "Não. Ela escreve o rascunho a partir do que você diz em poucas palavras, e só envia depois do seu OK."],
  ["Funciona com outros canais além do WhatsApp?", "Hoje: WhatsApp, Gmail e Google Agenda. Instagram, e-mail por IMAP e webchat estão previstos."],
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
    {
      "@type": "SoftwareApplication",
      name: "MagoBox",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, WhatsApp",
      description: "Assistente no WhatsApp que avisa de cada e-mail, mostra a agenda e cuida dos clientes, por texto ou áudio.",
      url: SITE,
      publisher: { "@id": `${SITE}/#org` },
      offers: { "@type": "Offer", price: "9.90", priceCurrency: "BRL" },
    },
  ],
};

export default function Landing() {
  return (
    <div className={`${display.variable} ${body.variable} min-h-screen bg-[#09070b] font-[family-name:var(--font-body)] text-[#e6eeea] antialiased`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#09070b]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="MagoBox — início"><Logo size={36} textClassName={`${H} text-xl font-bold tracking-tight text-white`} /></Link>
          <nav className="hidden items-center gap-8 text-sm text-[#a49eaf] md:flex">
            <a href="#vantagens" className="hover:text-white">Vantagens</a>
            <a href="#como" className="hover:text-white">Como funciona</a>
            <a href="#preco" className="hover:text-white">Preço</a>
            <a href="#duvidas" className="hover:text-white">Dúvidas</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="hidden text-sm text-[#a49eaf] hover:text-white sm:block">Entrar</Link>
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
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-[#a49eaf]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A78BFA]" /> 7 dias grátis, depois a partir de R$ 9,90/mês
            </p>
            <h1 className={`${H} text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl`}>
              Seu e-mail, sua agenda e seus clientes, <span className={TEAL}>dentro do WhatsApp.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#a49eaf]">
              Um assistente que avisa de cada e-mail, mostra sua agenda e cuida das conversas dos clientes. Você só digita um número ou manda um áudio.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/auth/register" className="rounded-xl bg-[#FBBF24] px-6 py-3.5 text-base font-semibold text-[#2E1065] transition hover:bg-[#FDE68A]">
                Começar 7 dias grátis
              </Link>
              <a href="#como" className="rounded-xl border border-white/15 px-6 py-3.5 text-base font-medium text-white transition hover:bg-white/5">
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
3️⃣ 💬 Conversas de clientes
4️⃣ 🤖 Perguntar à IA
5️⃣ 🧠 Minha memória
━━━━━━━━━━━━━━
💡 Responda com o número, escreva ou mande um áudio 🎙️`}</Bubble>
            <Bubble from="me">2</Bubble>
          </Phone>
        </div>
      </section>

      {/* Vantagens */}
      <section id="vantagens" className="border-t border-white/5 py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${TEAL}`}>Vantagens</p>
          <h2 className={`${H} mt-3 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>
            Menos abas abertas. Mais coisa resolvida.
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="bg-[#0d0b10] p-7">
                <div className={`mb-4 grid h-10 w-10 place-items-center rounded-lg bg-[#A78BFA]/10 ${TEAL}`}>
                  <Icon d={b.icon} />
                </div>
                <h3 className={`${H} text-lg font-bold`}>{b.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#a49eaf]">{b.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 rounded-xl border border-[#A78BFA]/20 bg-[#A78BFA]/5 px-5 py-4 text-[15px] text-[#E4DCFB]">
            <strong className="font-semibold">E ele aprende com você.</strong> Diga “lembre que respondo o João de forma informal” e os próximos rascunhos já saem no seu jeito.
          </p>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como" className="border-t border-white/5 py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 md:grid-cols-2">
          <div>
            <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${TEAL}`}>Como funciona</p>
            <h2 className={`${H} mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>
              Chegou um e-mail. Três toques e resolvido.
            </h2>
            <ol className="mt-10 space-y-7">
              {[
                ["Crie a conta e conecte o WhatsApp", "Leia um QR Code, como no WhatsApp Web. Leva menos de um minuto."],
                ["Conecte seu Google", "Autorize Gmail e Agenda pela tela do Google. Você revoga quando quiser."],
                ["Mande “oi” e pronto", "O assistente abre o menu. Daí em diante é só número ou áudio."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className={`${H} grid h-9 w-9 flex-none place-items-center rounded-full border border-[#A78BFA]/40 text-sm font-bold ${TEAL}`}>{i + 1}</span>
                  <div>
                    <h3 className="font-semibold">{t}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#a49eaf]">{d}</p>
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
      <section id="preco" className="border-t border-white/5 py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${TEAL}`}>Preço</p>
            <h2 className={`${H} mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>Escolha o plano do seu tamanho</h2>
            <p className="mt-3 text-[15px] text-[#a49eaf]">Todos começam com 7 dias grátis. Sem fidelidade e sem pegadinha: o limite de uso de IA de cada plano está claro desde o começo.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={`flex flex-col rounded-3xl border p-8 ${p.tag ? "border-[#A78BFA]/50 bg-gradient-to-b from-[#1a1233] to-[#0d0b10] shadow-[0_30px_80px_-30px_rgba(167,139,250,0.35)]" : "border-white/10 bg-[#0d0b10]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`${H} text-xl font-bold`}>{p.name}</h3>
                  {p.tag && <span className="rounded-full bg-[#A78BFA]/15 px-3 py-1 text-xs font-semibold text-[#C4B5FD]">{p.tag}</span>}
                </div>
                <p className="mt-1 text-sm text-[#a49eaf]">{p.who}</p>
                <p className="mt-6 flex items-end gap-1">
                  <span className="pb-1 text-lg text-[#a49eaf]">R$</span>
                  <span className={`${H} text-5xl font-extrabold leading-none tracking-tight`}>{p.price}</span>
                  <span className="pb-1 text-[#a49eaf]">/mês</span>
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
          <p className="mt-6 text-center text-xs text-[#868090]">Cancele antes do fim do teste e não paga nada. O teste tem um limite de uso de IA menor que o dos planos.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="duvidas" className="border-t border-white/5 py-20 md:py-28">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className={`${H} text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>Dúvidas comuns</h2>
          <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {q}
                  <span className={`text-xl transition group-open:rotate-45 ${TEAL}`}>+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-[#a49eaf]">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className={`${H} text-balance text-3xl font-bold tracking-tight sm:text-4xl`}>
            Teste por 7 dias e veja quanto tempo você ganha.
          </h2>
          <Link href="/auth/register" className="mt-8 inline-block rounded-xl bg-[#FBBF24] px-8 py-4 text-base font-semibold text-[#2E1065] transition hover:bg-[#FDE68A]">
            Criar minha conta
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 text-sm text-[#868090]">
          <Logo size={26} textClassName={`${H} text-base font-bold tracking-tight text-white`} />
          <span>© 2026 MagoBox. Todos os direitos reservados.</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacidade" className="hover:text-white">Política de Privacidade</Link>
            <Link href="/termos" className="hover:text-white">Termos de Serviço</Link>
            <Link href="/exclusao-de-dados" className="hover:text-white">Exclusão de dados</Link>
            <Link href="/auth/login" className="hover:text-white">Entrar</Link>
            <Link href="/auth/register" className="hover:text-white">Criar conta</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
