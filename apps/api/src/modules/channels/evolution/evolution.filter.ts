import { ArgumentsHost, Catch, ExceptionFilter, Logger, ServiceUnavailableException } from "@nestjs/common";
import { EvolutionError, evolutionMessage } from "./evolution.service";

/** Falha do Evolution vira 503 com uma mensagem que o painel pode mostrar (em vez de "Internal server error"). */
@Catch(EvolutionError)
export class EvolutionExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EvolutionExceptionFilter.name);

  catch(e: EvolutionError, host: ArgumentsHost) {
    this.logger.warn(e.message.slice(0, 300));
    const body = new ServiceUnavailableException(evolutionMessage(e)).getResponse();
    host.switchToHttp().getResponse().status(503).json(body);
  }
}
