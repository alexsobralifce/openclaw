import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, HttpException, HttpStatus } from "@nestjs/common";
import { GoogleService } from "../integrations/google/google.service";

const MAX_RANGE_MS = 92 * 24 * 3600 * 1000;
const SEND_WINDOW_MS = 3600 * 1000;
const SEND_PER_HOUR = Number(process.env.API_EMAIL_SEND_PER_HOUR || 30);

/** Gmail e Agenda do cliente expostos pela API pública, com auditoria e limites próprios. */
@Injectable()
export class GooglePublicService {
  private readonly logger = new Logger("PublicApi.Audit");
  private sends = new Map<string, number[]>();

  constructor(private google: GoogleService) {}

  private audit(keyId: string, workspaceId: string, action: string, account?: string) {
    this.logger.log(`[AUDIT-API] key=${keyId} ws=${workspaceId} ${action} account=${account ?? "(padrão)"}`);
  }

  /** Traduz falhas do Google/conta em erros HTTP claros, sem vazar detalhes internos. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = String(e?.message ?? e);
      if (/não conectad/i.test(msg)) throw new NotFoundException("Conta Google não conectada neste workspace");
      if (/Google API 404/.test(msg)) throw new NotFoundException("Recurso não encontrado");
      if (/Google API 4\d\d/.test(msg)) throw new BadRequestException("O Google recusou a requisição");
      throw new BadGatewayException("Falha ao comunicar com o Google");
    }
  }

  accounts(workspaceId: string) {
    return this.run(async () => ({ data: await this.google.listAccounts(workspaceId) }));
  }

  // ─── E-mail ────────────────────────────────────────────────────

  listEmails(keyId: string, workspaceId: string, q: { account?: string; q?: string; limit?: number }) {
    this.audit(keyId, workspaceId, "email.list", q.account);
    return this.run(async () => {
      const items = await this.google.gmailSearch(workspaceId, q.q ?? "in:inbox", q.account, q.limit ?? 10);
      return {
        data: items.map((m: any) => ({ id: m.id, from: m.de, subject: m.assunto, date: m.data, snippet: m.resumo, receivedAt: new Date(m.internalDate).toISOString() })),
      };
    });
  }

  readEmail(keyId: string, workspaceId: string, id: string, account?: string) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new BadRequestException("ID de e-mail inválido");
    this.audit(keyId, workspaceId, `email.read id=${id}`, account);
    return this.run(async () => {
      const m: any = await this.google.gmailRead(workspaceId, id, account);
      return { id: m.id, from: m.de, to: m.para, subject: m.assunto, date: m.data, body: m.corpo };
    });
  }

  sendEmail(keyId: string, workspaceId: string, d: { to: string; subject: string; text: string; account?: string }) {
    // impede injeção de cabeçalhos (quebras de linha) no assunto e no destinatário
    if (/[\r\n]/.test(d.subject) || /[\r\n,;<>\s]/.test(d.to)) throw new BadRequestException("Assunto ou destinatário inválido");

    const now = Date.now();
    const recent = (this.sends.get(keyId) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
    if (recent.length >= SEND_PER_HOUR) throw new HttpException("Limite de e-mails por hora excedido para esta chave", HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.sends.set(keyId, recent);

    this.audit(keyId, workspaceId, `email.send to=${d.to} subjectLen=${d.subject.length}`, d.account);
    return this.run(async () => {
      await this.google.gmailSend(workspaceId, d.to, d.subject, d.text, d.account);
      return { status: "sent" };
    });
  }

  // ─── Agenda ────────────────────────────────────────────────────

  listEvents(keyId: string, workspaceId: string, q: { from: string; to: string; account?: string }) {
    const from = new Date(q.from).getTime();
    const to = new Date(q.to).getTime();
    if (!(to > from)) throw new BadRequestException("'to' deve ser posterior a 'from'");
    if (to - from > MAX_RANGE_MS) throw new BadRequestException("Intervalo máximo de 92 dias");
    this.audit(keyId, workspaceId, "calendar.list", q.account);
    return this.run(async () => {
      const items = await this.google.calendarList(workspaceId, new Date(from).toISOString(), new Date(to).toISOString(), q.account);
      return { data: items.map((e: any) => ({ id: e.id, title: e.titulo, start: e.inicio, end: e.fim, location: e.local })) };
    });
  }

  createEvent(keyId: string, workspaceId: string, d: { title: string; start: string; end: string; description?: string; attendees?: string[]; account?: string }) {
    if (!(new Date(d.end).getTime() > new Date(d.start).getTime())) throw new BadRequestException("'end' deve ser posterior a 'start'");
    this.audit(keyId, workspaceId, `calendar.create attendees=${d.attendees?.length ?? 0}`, d.account);
    return this.run(async () => {
      const { account, ...ev } = d;
      const r: any = await this.google.calendarCreate(workspaceId, ev, account);
      return { id: r.id, link: r.link };
    });
  }
}
