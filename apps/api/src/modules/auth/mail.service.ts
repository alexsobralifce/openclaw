import { Injectable, Logger } from "@nestjs/common";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Corpo HTML simples e legível (e-mail transacional: sem imagens, poucos estilos). `lines` são texto puro e saem escapadas. */
export function mailHtml(title: string, lines: string[], action?: { label: string; url: string }): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.5">${escapeHtml(l)}</p>`).join("");
  const button = action
    ? `<p style="margin:20px 0"><a href="${escapeHtml(action.url)}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;display:inline-block">${escapeHtml(action.label)}</a></p><p style="margin:0 0 12px;color:#6b7280;font-size:12px;word-break:break-all">Se o botão não abrir, copie este endereço: ${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f4f6;padding:24px;font-family:system-ui,sans-serif"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px"><h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(title)}</h1>${body}${button}<p style="margin:20px 0 0;color:#9ca3af;font-size:12px">MagoBox · este é um aviso automático, não responda.</p></div></body></html>`;
}

/**
 * Envio de e-mails do sistema (confirmação de cadastro, recuperação de senha, aviso ao root) pelo Resend.
 * Sem `RESEND_API_KEY` não envia nada e só registra no log (desenvolvimento). `RESEND_FROM` precisa ser de um domínio verificado no Resend.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  enabled() {
    return !!process.env.RESEND_API_KEY;
  }

  /** Nunca lança: falha de e-mail não pode derrubar cadastro nem recuperação. Devolve se o Resend aceitou. */
  async send(to: string | string[], subject: string, html: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      this.logger.warn(`RESEND_API_KEY não configurada: e-mail "${subject}" não enviado.`);
      return false;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.RESEND_FROM || "MagoBox <nao-responda@magobox.com.br>", to: Array.isArray(to) ? to : [to], subject, html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Resend recusou "${subject}": HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.logger.warn(`Falha ao enviar "${subject}": ${e.message}`);
      return false;
    }
  }
}
