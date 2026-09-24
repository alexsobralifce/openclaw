import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { EvolutionService } from "../evolution/evolution.service";
import { GoogleService } from "../../integrations/google/google.service";
import { MemoryService } from "./memory.service";
import { suspiciousReasons } from "./security";

const TZ = "America/Fortaleza";
const TTL = 30 * 60_000;
const GREETING = /^(oi+|ol[aá]|oie|hey|hello|e a[ií]|bom dia|boa tarde|boa noite|menu|in[ií]cio|come[cç]ar|ajuda)\b/i;

interface State {
  screen: string;
  data: any;
  at: number;
}

const WORDS: Record<string, number> = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };
const ALIASES: Record<string, Record<string, number>> = {
  notif: { ler: 1, abrir: 1, apagar: 2, excluir: 2, responder: 3, spam: 4, "marcar como spam": 4, "e spam": 4 },
  email: { responder: 1, apagar: 2, excluir: 2, marcar: 3, "marcar como lido": 3, spam: 4, "marcar como spam": 4 },
  email_draft: { enviar: 1, mandar: 1, "pode enviar": 1, confirmar: 1, sim: 1, refazer: 2, cancelar: 0 },
  client_draft: { enviar: 1, mandar: 1, refazer: 2, cancelar: 0 },
  event_confirm: { confirmar: 1, confirma: 1, sim: 1, refazer: 2, cancelar: 0 },
  client: { responder: 1, resolver: 2 },
  confirm_ai: { confirmar: 1, confirma: 1, sim: 1, "pode enviar": 1, cancelar: 0, nao: 0, não: 0 },
};

const DIV = "━━━━━━━━━━━━━━━━━━";
const KEYS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const key = (n: number) => KEYS[n] ?? `${n}.`;
const head = (icon: string, title: string, sub?: string) => `${icon} *${title}*${sub ? `\n_${sub}_` : ""}\n${DIV}`;
const opts = (...items: [number, string, string][]) => items.map(([n, icon, label]) => `${key(n)} ${icon} ${label}`).join("\n");
const foot = (hint: string) => `${DIV}\n💡 _${hint}_`;
const BACK: [number, string, string] = [0, "⬅️", "Voltar"];
const mono = (rows: string[]) => "```" + rows.join("\n") + "```";
const padTo = (t: string, n: number) => short(t, n).padEnd(n);

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const personName = (from: string) => (from || "").replace(/<.*>/, "").replace(/["']/g, "").trim() || from;
const emailOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;
const dateStr = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 864e5).toLocaleDateString("sv-SE", { timeZone: TZ });

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);
  private states = new Map<string, State>();

  private executor?: (ws: string, action: { name: string; args: any }) => Promise<any>;

  constructor(private google: GoogleService, private evolution: EvolutionService, private memory: MemoryService) {}

  setExecutor(fn: (ws: string, action: { name: string; args: any }) => Promise<any>) {
    this.executor = fn;
  }

  // ─── Entrada ──────────────────────────────────────────────────

  /** Retorna a resposta do menu, ou null para deixar a IA responder livremente. */
  async respond(workspaceId: string, raw: string): Promise<string | null> {
    const text = raw.trim();
    let st = this.states.get(workspaceId);
    if (st && Date.now() - st.at > TTL) st = undefined;
    const clean = text.toLowerCase().replace(/[.!?,;:"“”']/g, "").trim();
    const isInput = !!st && st.screen.endsWith("_input");
    let n: number | null = null;
    if (/^\d{1,2}$/.test(clean)) n = Number(clean);
    else if (!isInput && clean in WORDS) n = WORDS[clean];
    else if (!isInput && clean === "voltar") n = 0;
    else if (st && !isInput) n = ALIASES[st.screen]?.[clean] ?? null;

    try {
      const flat = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (/(sair do modo direcao|desligar (o )?modo direcao|desativar (o )?modo direcao|parei de dirigir|^cheguei)/.test(flat)) return await this.drivingSet(workspaceId, false);
      if (/(modo direcao|vou dirigir|estou dirigindo|to dirigindo)/.test(flat)) return await this.drivingSet(workspaceId, true);
      if (GREETING.test(text)) return await this.mainMenu(workspaceId, true);
      if (!st) return n !== null ? await this.mainMenu(workspaceId, false) : null;
      return await this.route(workspaceId, st, text, n);
    } catch (err: any) {
      this.logger.error(`Menu falhou: ${err.message}`);
      this.states.delete(workspaceId);
      return `😕 *Ops, tive um problema:* ${short(err.message, 160)}\n💡 _Digite *menu* para recomeçar._`;
    }
  }

  private set(ws: string, screen: string, data: any = {}) {
    this.states.set(ws, { screen, data, at: Date.now() });
  }

  private async route(ws: string, st: State, text: string, n: number | null): Promise<string | null> {
    const d = st.data;
    switch (st.screen) {
      case "main": {
        if (n === null) return null;
        const opt = d.options[n - 1];
        return opt ? this.runAction(ws, opt) : this.invalid();
      }
      case "free":
        return n === 0 ? this.mainMenu(ws, false) : null;

      // E-mails
      case "emails": {
        if (n === 0) return this.mainMenu(ws, false);
        if (n === null) return null;
        const item = d.items[n - 1];
        return item ? this.emailOpen(ws, item.account ?? d.account, item.id) : this.invalid();
      }
      case "notif": {
        if (n === 0) return this.mainMenu(ws, false);
        if (n === 1) return this.emailOpen(ws, d.account, d.id);
        if (n === 2) return this.emailTrash(ws, d.account, d.id, false);
        if (n === 4) return this.emailSpam(ws, d.account, d.id, false);
        if (n === 3) {
          const m: any = await this.google.gmailRead(ws, d.id, d.account);
          this.set(ws, "email_reply_input", { ...m, account: d.account });
          return `${head("🎙️", "Responder e-mail", `${short(personName(m.de), 28)} · ${short(m.assunto ?? "(sem assunto)", 40)}`)}\nMe diga por texto ou áudio o que responder, que eu escrevo o e-mail.\n${DIV}\n${opts(BACK)}`;
        }
        return n === null ? null : this.invalid();
      }
      case "email": {
        if (n === 0) return this.emailList(ws, d.account);
        if (n === 1) {
          this.set(ws, "email_reply_input", d);
          return `${head("🎙️", "Responder e-mail")}\nMe diga por texto ou áudio o que responder, que eu escrevo o e-mail.\n_Ex.: "confirmo presença" ou "peça mais prazo"_\n${DIV}\n${opts(BACK)}`;
        }
        if (n === 2) return this.emailTrash(ws, d.account, d.id, true);
        if (n === 4) return this.emailSpam(ws, d.account, d.id, true);
        if (n === 3) {
          await this.google.gmailMarkRead(ws, d.id, d.account);
          return `✅ *Marcado como lido.*\n\n${await this.emailList(ws, d.account)}`;
        }
        return n === null ? null : this.invalid();
      }
      case "email_reply_input": {
        if (n === 0) return this.emailReopen(ws, d);
        const draft = await this.ai(
          "Escreva uma resposta de e-mail em português do Brasil, cordial, natural e objetiva, em nome do Alexandre, seguindo a instrução dada. Devolva só o corpo do e-mail, sem assunto e sem assinatura longa.",
          `E-mail recebido:\n${d.corpo}\n\nInstrução: ${text}`,
          false,
          ws,
        ).catch(() => text);
        this.set(ws, "email_draft", { ...d, draft });
        return `${head("✍️", "Rascunho da resposta")}\n📨 *Para:* ${emailOf(d.de)}\n${DIV}\n_${draft}_\n${DIV}\n${opts([1, "✅", "Enviar"], [2, "🔄", "Refazer"], [0, "❌", "Cancelar"])}`;
      }
      case "email_draft": {
        if (n === 1) {
          await this.google.gmailSend(ws, emailOf(d.de), `Re: ${d.assunto ?? ""}`.replace(/^Re: Re: /i, "Re: "), d.draft, d.account);
          return `✅ *E-mail enviado!*\n\n${await this.emailList(ws, d.account)}`;
        }
        if (n === 2) {
          this.set(ws, "email_reply_input", d);
          return `🔄 Beleza! Me diga de novo o que responder.\n${DIV}\n${opts(BACK)}`;
        }
        if (n === 0) return this.emailReopen(ws, d);
        return this.invalid();
      }

      // Agenda
      case "agenda": {
        if (n === 0) return this.mainMenu(ws, false);
        if (n === 1) return this.agendaList(ws, 0, 0, "hoje");
        if (n === 2) return this.agendaList(ws, 1, 1, "amanhã");
        if (n === 3) return this.agendaList(ws, 0, 7, "nos próximos 7 dias");
        if (n === 4) {
          this.set(ws, "event_input");
          return `${head("➕", "Novo evento")}\nDescreva do seu jeito, por texto ou áudio 🎙️.\n_Ex.: "reunião com o João amanhã às 15h por 1 hora"_\n${DIV}\n${opts(BACK)}`;
        }
        return n === null ? null : this.invalid();
      }
      case "event_input": {
        if (n === 0) return this.agendaMenu(ws);
        const ev = await this.parseEvent(text);
        if (ev.error) return `🤔 Preciso de mais um detalhe: *${ev.error}*\n_Me conte o evento completo de novo, ou digite 0 para voltar._`;
        this.set(ws, "event_confirm", ev);
        return `${head("🗓️", "Confirmar evento")}\n📌 *Título:* ${ev.title}\n🕐 *Quando:* ${this.when(ev.start, ev.end)}\n${DIV}\n${opts([1, "✅", "Confirmar"], [2, "🔄", "Refazer"], [0, "❌", "Cancelar"])}`;
      }
      case "event_confirm": {
        if (n === 0) return this.agendaMenu(ws);
        if (n === 2) {
          this.set(ws, "event_input");
          return `🔄 Certo! Descreva o evento de novo.\n${DIV}\n${opts(BACK)}`;
        }
        if (n !== 1) return this.invalid();
        const accounts = await this.google.listAccounts(ws);
        if (accounts.length === 0) return this.noGoogle();
        if (accounts.length === 1) return this.eventCreate(ws, d, accounts[0]);
        this.set(ws, "event_account", { ev: d, accounts });
        return `${head("📅", "Em qual agenda?")}\n${accounts.map((a: string, i: number) => `${key(i + 1)} 📥 ${a}`).join("\n")}\n${opts([0, "❌", "Cancelar"])}`;
      }
      case "event_account": {
        if (n === 0) return this.agendaMenu(ws);
        const acc = n !== null ? d.accounts[n - 1] : null;
        return acc ? this.eventCreate(ws, d.ev, acc) : this.invalid();
      }

      // Confirmação de ações pedidas à IA
      case "confirm_ai": {
        if (n === 0) {
          this.states.delete(ws);
          return "❌ *Cancelado.* Nada foi enviado.\n💡 _Digite *menu* quando quiser._";
        }
        if (n !== 1) return n === null ? this.invalid() : this.invalid();
        this.states.delete(ws);
        const out: string[] = [];
        for (const a of d.actions) {
          try {
            await this.executor!(ws, a);
            out.push(`✅ ${this.actionLabel(a)}`);
          } catch (e: any) {
            out.push(`⚠️ Falhou (${this.actionLabel(a)}): ${short(e.message, 100)}`);
          }
        }
        return `${head("📋", "Resultado")}\n${out.join("\n")}\n${DIV}\n💡 _Digite *menu* quando quiser._`;
      }

      // Memória
      case "memory": {
        if (n === 0) return this.mainMenu(ws, false);
        if (n === null) return null;
        const item = d.items[n - 1];
        if (!item) return this.invalid();
        await this.memory.remove(ws, item.id);
        return `🧽 *Esqueci:* _${short(item.content, 80)}_\n\n${await this.memoryList(ws)}`;
      }

      // Clientes
      case "clients": {
        if (n === 0) return this.mainMenu(ws, false);
        if (n === null) return null;
        const item = d.items[n - 1];
        return item ? this.clientOpen(ws, item.id) : this.invalid();
      }
      case "client": {
        if (n === 0) return this.clientList(ws);
        if (n === 1) {
          this.set(ws, "client_reply_input", d);
          return `${head("🎙️", "Responder cliente", d.name)}\nMe diga por texto ou áudio o que responder, que eu escrevo a mensagem.\n${DIV}\n${opts(BACK)}`;
        }
        if (n === 2) {
          await prisma.conversation.update({ where: { id: d.id, workspaceId: ws }, data: { status: "RESOLVED" } });
          return `✅ *Conversa com ${d.name} resolvida.*\n\n${await this.clientList(ws)}`;
        }
        return n === null ? null : this.invalid();
      }
      case "client_reply_input": {
        if (n === 0) return this.clientOpen(ws, d.id);
        const draft = await this.ai(
          "Escreva uma resposta curta de atendimento por WhatsApp em português do Brasil, cordial e natural, seguindo a instrução dada. Devolva só a mensagem.",
          `Última mensagem do cliente: ${d.lastInbound ?? ""}\n\nInstrução: ${text}`,
          false,
          ws,
        ).catch(() => text);
        this.set(ws, "client_draft", { ...d, draft });
        return `${head("✍️", "Mensagem para o cliente")}\n👤 *Para:* ${d.name}\n${DIV}\n_${draft}_\n${DIV}\n${opts([1, "✅", "Enviar"], [2, "🔄", "Refazer"], [0, "❌", "Cancelar"])}`;
      }
      case "client_draft": {
        if (n === 1) {
          await this.clientSend(ws, d.id, d.draft);
          return `✅ *Mensagem enviada para ${d.name}.*\n\n${await this.clientOpen(ws, d.id)}`;
        }
        if (n === 2) {
          this.set(ws, "client_reply_input", d);
          return `🔄 Beleza! Me diga de novo o que responder.\n${DIV}\n${opts(BACK)}`;
        }
        if (n === 0) return this.clientOpen(ws, d.id);
        return this.invalid();
      }
    }
    return null;
  }

  // ─── Telas ────────────────────────────────────────────────────

  private invalid() {
    return "⚠️ Não tenho essa opção. Escolha um número da lista ou digite *menu*.";
  }

  private noGoogle() {
    return `${head("🔌", "Google não conectado")}\nConecte em *Canais → Conectar Google* no painel.`;
  }

  private async mainOptions(ws: string) {
    const accounts = await this.google.listAccounts(ws);
    const options: any[] = accounts.map((account: string) => ({ type: "emails", account }));
    const labels: { icon: string; label: string; sub?: string }[] = accounts.map((a: string) => ({ icon: "📧", label: "E-mails", sub: a }));
    if (accounts.length) {
      options.push({ type: "agenda" });
      labels.push({ icon: "📅", label: "Google Agenda" });
    }
    options.push({ type: "clients" });
    labels.push({ icon: "💬", label: "Conversas de clientes" });
    options.push({ type: "free" });
    labels.push({ icon: "🤖", label: "Perguntar à IA" });
    options.push({ type: "memory" });
    labels.push({ icon: "🧠", label: "Minha memória" });
    options.push({ type: "driving" });
    labels.push({ icon: "🚗", label: "Modo direção" });
    return { options, labels };
  }

  /** Monta o aviso de novos e-mails e prepara as opções de resposta. */
  async notifyNew(ws: string, items: { account: string; id: string; de: string; assunto: string }[]): Promise<string> {
    const st = this.states.get(ws);
    const busy = !!st && Date.now() - st.at < 5 * 60_000 && /(_input|_draft|_confirm|_account)$/.test(st.screen);
    if (busy) {
      return items.length === 1
        ? `📩 *Novo e-mail* de *${short(personName(items[0].de), 30)}*\n📌 ${short(items[0].assunto ?? "", 60)}\n_Quando terminar por aqui, digite *menu* para vê-lo._`
        : `📩 *Chegaram ${items.length} e-mails novos.*\n_Quando terminar por aqui, digite *menu*._`;
    }
    if (items.length === 1) {
      const m = items[0];
      this.set(ws, "notif", m);
      return [
        head("📩", "Novo e-mail"),
        `👤 *De:* ${personName(m.de)}`,
        `📌 *Assunto:* ${short(m.assunto ?? "(sem assunto)", 80)}`,
        `📥 *Conta:* ${m.account}`,
        DIV,
        opts([1, "📖", "Ler"], [2, "🗑️", "Apagar"], [3, "↩️", "Responder"], [4, "🚫", "Spam"]),
      ].join("\n");
    }
    const multi = new Set(items.map((i) => i.account)).size > 1;
    this.set(ws, "emails", { account: undefined, items });
    const cards = items.slice(0, 6).map((m, i) => this.emailCard(i + 1, m, multi));
    const extra = items.length > 6 ? `\n➕ _${items.length - 6} não listados_` : "";
    return [head("📩", `${items.length} novos e-mails`), cards.join("\n\n") + extra, foot("Responda com o número para abrir"), opts([0, "🏠", "Menu"])].join("\n");
  }

  private emailCard(n: number, m: any, showAccount = false) {
    const acc = showAccount && m.account ? `\n     📥 _${m.account.split("@")[0]}_` : "";
    return `${key(n)} 👤 *${short(personName(m.de), 30)}*\n     📌 ${short(m.assunto ?? "(sem assunto)", 55)}${acc}`;
  }

  private fmtDate(v?: string) {
    const d = v ? new Date(v) : null;
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  private async mainMenu(ws: string, greet: boolean) {
    const { options, labels } = await this.mainOptions(ws);
    this.set(ws, "main", { options });
    const h = Number(new Date().toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }));
    const [icon, saud] = h < 12 ? ["☀️", "Bom dia"] : h < 18 ? ["🌤️", "Boa tarde"] : ["🌙", "Boa noite"];
    const title = greet ? `${saud}! Sou seu assistente` : "Menu principal";
    const items = labels.map((l, i) => `${key(i + 1)} ${l.icon} ${l.label}${l.sub ? `\n     _${l.sub}_` : ""}`);
    return [head(greet ? icon : "🏠", title, "O que vamos ver agora?"), items.join("\n"), foot("Responda com o número, escreva ou mande um áudio 🎙️")].join("\n");
  }

  private async runAction(ws: string, opt: any) {
    if (opt.type === "emails") return this.emailList(ws, opt.account);
    if (opt.type === "agenda") return this.agendaMenu(ws);
    if (opt.type === "clients") return this.clientList(ws);
    if (opt.type === "memory") return this.memoryList(ws);
    if (opt.type === "driving") return this.drivingSet(ws, !(await this.isDriving(ws)));
    this.set(ws, "free");
    return [head("🤖", "Assistente livre"), "Pode falar! Escreva ou mande um áudio 🎙️ com o que precisa.", DIV, opts(BACK)].join("\n");
  }

  // Memória e confirmações

  private async memoryList(ws: string) {
    const items = await this.memory.list(ws, 15);
    this.set(ws, "memory", { items });
    if (!items.length) {
      return [head("🧠", "Minha memória"), "Ainda não guardei nada sobre você.", '_Diga, por exemplo: "lembre que respondo o João de forma informal"._', DIV, opts(BACK)].join("\n");
    }
    const lines = items.map((m, i) => `${key(i + 1)} 📌 ${short(m.content, 90)}`);
    return [head("🧠", "O que eu sei sobre você"), lines.join("\n"), foot("Digite o número para eu esquecer aquele item"), opts(BACK)].join("\n");
  }

  private actionLabel(a: { name: string; args: any }) {
    if (a.name === "gmail_send") return `E-mail para ${a.args.to}`;
    if (a.name === "calendar_create_event") return `Evento "${a.args.title}"`;
    if (a.name === "reply_to_conversation") return "Resposta ao cliente";
    return a.name;
  }

  /** Pede confirmação do dono antes de executar ações sensíveis sugeridas pela IA. */
  async requestConfirm(ws: string, actions: { name: string; args: any }[]): Promise<string> {
    this.set(ws, "confirm_ai", { actions });
    const cards: string[] = [];
    for (const a of actions) {
      if (a.name === "gmail_send") {
        cards.push(`✉️ *Enviar e-mail*\n📨 *Para:* ${a.args.to}\n📌 *Assunto:* ${short(a.args.subject ?? "", 80)}\n_${short(a.args.text ?? "", 300)}_${a.args.account ? `\n📥 *Conta:* ${a.args.account}` : ""}`);
      } else if (a.name === "calendar_create_event") {
        cards.push(`🗓️ *Criar evento*\n📌 *Título:* ${a.args.title}\n🕐 *Quando:* ${this.when(a.args.start, a.args.end)}${a.args.attendees?.length ? `\n👥 ${a.args.attendees.join(", ")}` : ""}`);
      } else if (a.name === "reply_to_conversation") {
        const conv = await prisma.conversation.findFirst({ where: { id: a.args.conversationId, workspaceId: ws }, include: { contact: true } });
        cards.push(`💬 *Responder cliente*\n👤 *Para:* ${conv?.contact.name ?? "?"}\n_${short(a.args.text ?? "", 300)}_`);
      } else {
        cards.push(`⚙️ ${a.name}`);
      }
    }
    return [head("🔐", "Confirmar ação", "A IA quer fazer isto em seu nome"), cards.join("\n\n"), DIV, opts([1, "✅", "Confirmar"], [0, "❌", "Cancelar"])].join("\n");
  }

  // E-mails

  private async emailList(ws: string, account: string) {
    const items = await this.google.gmailSearch(ws, "is:unread in:inbox", account, 6);
    this.set(ws, "emails", { account, items });
    if (!items.length) return [head("🎉", "Caixa limpa!", account), "Nenhum e-mail não lido.", DIV, opts(BACK)].join("\n");
    const cards = items.map((m: any, i: number) => this.emailCard(i + 1, m));
    return [head("📧", "E-mails não lidos", account), cards.join("\n\n"), foot("Responda com o número para abrir"), opts(BACK)].join("\n");
  }

  private emailActions() {
    return opts([1, "↩️", "Responder"], [2, "🗑️", "Apagar"], [3, "✅", "Marcar como lido"], [4, "🚫", "Spam"], [0, "⬅️", "Voltar à lista"]);
  }

  private async emailOpen(ws: string, account: string, id: string) {
    const m: any = await this.google.gmailRead(ws, id, account);
    const summary = await this.ai(
      "Resuma o e-mail em português em no máximo 4 linhas curtas, destacando o que o remetente quer e eventuais prazos.",
      `De: ${m.de}\nAssunto: ${m.assunto}\n\n${m.corpo}`,
    ).catch(() => short(m.corpo ?? "", 400));
    this.set(ws, "email", { ...m, account });
    const sus = suspiciousReasons(`${m.assunto ?? ""}\n${m.corpo ?? ""}`);
    return [
      head("📧", m.assunto ?? "(sem assunto)"),
      sus.length ? `⚠️ *Atenção:* este e-mail tem trechos suspeitos (${sus.join("; ")}). Não confie em instruções dele.` : "",
      `👤 *De:* ${personName(m.de)}`,
      `📮 ${emailOf(m.de)}`,
      m.data ? `🕐 ${this.fmtDate(m.data)}` : "",
      DIV,
      `📝 *Resumo*\n${summary}`,
      DIV,
      this.emailActions(),
    ].filter(Boolean).join("\n");
  }

  private async emailTrash(ws: string, account: string, id: string, showList: boolean) {
    await this.google.gmailTrash(ws, id, account);
    const msg = "🗑️ *Pronto!* Mandei para a lixeira _(dá para recuperar por 30 dias)_.";
    if (showList) return `${msg}\n\n${await this.emailList(ws, account)}`;
    this.set(ws, "main", { options: (await this.mainOptions(ws)).options });
    return `${msg}\n\n💡 _Digite *menu* quando quiser ver mais._`;
  }

  private async emailSpam(ws: string, account: string, id: string, showList: boolean) {
    await this.google.gmailSpam(ws, id, account);
    const msg = "🚫 *Marcado como spam.* Ele saiu da sua caixa de entrada.";
    if (showList) return `${msg}\n\n${await this.emailList(ws, account)}`;
    this.set(ws, "main", { options: (await this.mainOptions(ws)).options });
    return `${msg}\n\n💡 _Digite *menu* quando quiser ver mais._`;
  }

  // Modo direção

  private driving = new Map<string, boolean>();

  async isDriving(ws: string): Promise<boolean> {
    if (this.driving.has(ws)) return this.driving.get(ws) as boolean;
    const wa = await prisma.channel.findFirst({ where: { workspaceId: ws, type: "WHATSAPP" } });
    const on = !!(wa?.config as any)?.drivingMode;
    this.driving.set(ws, on);
    return on;
  }

  private async drivingSet(ws: string, on: boolean) {
    const wa = await prisma.channel.findFirst({ where: { workspaceId: ws, type: "WHATSAPP" } });
    if (wa) await prisma.channel.update({ where: { id: wa.id }, data: { config: { ...(wa.config as any), drivingMode: on } } });
    this.driving.set(ws, on);
    this.set(ws, "main", { options: (await this.mainOptions(ws)).options });
    if (!on) return `✅ *Modo direção desligado.*\nVoltei a responder por texto.`;
    const warn = process.env.GEMINI_API_KEY ? "" : "\n⚠️ _A voz ainda não está configurada no servidor; por enquanto respondo por texto._";
    return [
      head("🚗", "Modo direção ligado", "Mãos no volante, eu falo por você"),
      "Vou avisar dos e-mails por *áudio*. Responda também por áudio, dizendo *ler*, *apagar*, *responder* ou *spam*.",
      "Para sair, diga *sair do modo direção*.",
    ].join("\n") + warn;
  }

  private async emailReopen(ws: string, d: any) {
    this.set(ws, "email", d);
    return [head("📧", d.assunto ?? "(sem assunto)", "Voltando ao e-mail"), this.emailActions()].join("\n");
  }

  // Agenda

  private agendaMenu(ws: string) {
    this.set(ws, "agenda");
    return `${head("📅", "Google Agenda", "O que você quer ver?")}\n${this.agendaOptions()}`;
  }

  private agendaOptions() {
    return opts([1, "📌", "Hoje"], [2, "🌅", "Amanhã"], [3, "🗓️", "Próximos 7 dias"], [4, "➕", "Criar evento"], BACK);
  }

  private async agendaList(ws: string, fromDay: number, toDay: number, label: string) {
    const accounts = await this.google.listAccounts(ws);
    const min = `${dateStr(fromDay)}T00:00:00-03:00`;
    const max = `${dateStr(toDay)}T23:59:59-03:00`;
    const all: any[] = [];
    for (const account of accounts) {
      const evs = await this.google.calendarList(ws, min, max, account);
      evs.forEach((e: any) => all.push({ ...e, account }));
    }
    all.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    this.set(ws, "agenda");
    const title = `Agenda · ${label}`;
    if (!all.length) return [head("📅", title), "🙌 Nada marcado por aqui.", DIV, this.agendaOptions()].join("\n");

    const multi = accounts.length > 1;
    const letter = (acc: string) => String.fromCharCode(65 + accounts.indexOf(acc));
    const days = new Map<string, any[]>();
    for (const e of all) {
      const k = String(e.inicio).includes("T") ? new Date(e.inicio).toLocaleDateString("sv-SE", { timeZone: TZ }) : String(e.inicio).slice(0, 10);
      days.set(k, [...(days.get(k) ?? []), e]);
    }
    const blocks = [...days.entries()].map(([k, evs]) => {
      const dl = new Date(`${k}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" });
      const rows = evs.map((e) => {
        const time = String(e.inicio).includes("T")
          ? new Date(e.inicio).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
          : "dia todo";
        return `${padTo(time, 8)} ${multi ? `${letter(e.account)} ` : ""}${short(e.titulo ?? "(sem título)", multi ? 22 : 24)}`;
      });
      return `📆 *${k === dateStr(0) ? "Hoje · " : ""}${dl}*\n${mono(rows)}`;
    });
    const legend = multi ? `\n🔖 _${accounts.map((a: string) => `${letter(a)} = ${a.split("@")[0]}`).join(" · ")}_` : "";
    return [head("📅", title), blocks.join("\n"), legend, DIV, this.agendaOptions()].filter(Boolean).join("\n");
  }

  private when(start: string, end?: string | null) {
    if (!start.includes("T")) return "dia todo";
    const s = new Date(start);
    const time = (x: Date) => x.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
    const date = s.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
    return `${date} ${time(s)}${end ? `–${time(new Date(end))}` : ""}`;
  }

  private async parseEvent(text: string): Promise<any> {
    const hoje = new Date().toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "full", timeStyle: "short" });
    const out = await this.ai(
      `Extraia um evento de agenda do texto. Hoje é ${hoje} (fuso -03:00). Responda apenas JSON: {"title":string,"start":"ISO 8601 com -03:00","end":"ISO 8601 com -03:00","description":string|null}. Se não houver duração, use 1 hora. Se faltar informação essencial (como o dia ou a hora), responda {"error":"o que falta"}.`,
      text,
      true,
    );
    return JSON.parse(out);
  }

  private async eventCreate(ws: string, ev: any, account: string) {
    await this.google.calendarCreate(ws, ev, account);
    this.set(ws, "agenda");
    return [head("✅", "Evento criado!"), `📌 *${ev.title}*`, `🕐 ${this.when(ev.start, ev.end)}`, `📥 ${account}`, DIV, this.agendaOptions()].join("\n");
  }

  // Clientes

  private async clientList(ws: string) {
    const convs = await prisma.conversation.findMany({
      where: { workspaceId: ws, status: { in: ["OPEN", "PENDING"] } },
      include: { contact: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });
    this.set(ws, "clients", { items: convs.map((c) => ({ id: c.id })) });
    if (!convs.length) return [head("🎉", "Tudo em dia!"), "Nenhuma conversa de cliente em aberto.", DIV, opts(BACK)].join("\n");
    const cards = convs.map((c, i) => `${key(i + 1)} 👤 *${short(c.contact.name, 28)}* ${c.status === "PENDING" ? "🟡" : "🟢"}\n     💬 ${short(c.messages[0]?.body ?? "", 55)}`);
    return [head("💬", "Conversas em aberto", "🟢 aberta · 🟡 pendente"), cards.join("\n\n"), foot("Responda com o número para abrir"), opts(BACK)].join("\n");
  }

  private async clientOpen(ws: string, id: string) {
    const c = await prisma.conversation.findFirstOrThrow({
      where: { id, workspaceId: ws },
      include: { contact: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    const msgs = [...c.messages].reverse();
    const lastInbound = [...c.messages].find((m) => m.direction === "INBOUND")?.body;
    this.set(ws, "client", { id, name: c.contact.name, lastInbound });
    const lines = msgs.map((m) => `${m.direction === "INBOUND" ? "👤" : "🧑‍💼"} *${m.direction === "INBOUND" ? short(c.contact.name, 16) : "Você"}:* ${short(m.body, 120)}`);
    return [
      head("💬", c.contact.name, c.contact.phone ?? undefined),
      lines.join("\n"),
      DIV,
      opts([1, "↩️", "Responder"], [2, "✅", "Marcar como resolvida"], [0, "⬅️", "Voltar à lista"]),
    ].join("\n");
  }

  private async clientSend(ws: string, id: string, text: string) {
    const c = await prisma.conversation.findFirstOrThrow({
      where: { id, workspaceId: ws },
      include: { contact: true, channel: true },
    });
    const cfg = c.channel.config as any;
    const res = await this.evolution.sendText(cfg.instanceName, c.contact.phone!, text);
    await prisma.message.create({
      data: { conversationId: c.id, body: text, direction: "OUTBOUND", type: "TEXT", externalId: res?.key?.id },
    });
  }

  // ─── IA auxiliar ──────────────────────────────────────────────

  private async ai(system: string, user: string, json = false, ws?: string): Promise<string> {
    const key = process.env.OPENAI_API_KEY;
    if (ws) {
      const mem = await this.memory.promptBlock(ws);
      if (mem) system = `${system}\n\n${mem}`;
    }
    if (!key) throw new Error("OPENAI_API_KEY não configurada");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data: any = await res.json();
    return (data.choices[0].message.content ?? "").trim();
  }
}
