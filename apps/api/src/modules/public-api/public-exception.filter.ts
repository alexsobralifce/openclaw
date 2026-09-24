import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";

/** Erros da API pública no formato { error: { code, message } }. */
@Catch()
export class PublicExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("PublicApi");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: any = exception.getResponse();
      const message = Array.isArray(body?.message) ? body.message.join("; ") : (body?.message ?? exception.message);
      return res.status(status).json({ error: { code: CODES[status] ?? "error", message } });
    }
    this.logger.error((exception as Error)?.message ?? String(exception));
    return res.status(500).json({ error: { code: "internal_error", message: "Erro interno" } });
  }
}

const CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};
