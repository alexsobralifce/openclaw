import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service";

/** Sem autenticação e sem dados de negócio: só o estado e o nome do que falhou. */
@Controller("health")
export class HealthController {
  constructor(private health: HealthService) {}

  @Get()
  async live() {
    const r = await this.health.live();
    if (r.status !== "ok") throw new ServiceUnavailableException(r);
    return r;
  }

  @Get("full")
  async full() {
    const r = await this.health.full();
    if (r.status !== "ok") throw new ServiceUnavailableException(r);
    return r;
  }
}
