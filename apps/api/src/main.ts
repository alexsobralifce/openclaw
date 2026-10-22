import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { configureBodyParsers } from "./body-parsers";
import { webOrigins } from "./web-origins";
import { csrfOriginCheck } from "./modules/auth/session-cookie";

function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = ["DATABASE_URL", "JWT_SECRET", "WEBHOOK_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Variáveis obrigatórias ausentes em produção: ${missing.join(", ")}`);
  if ((process.env.JWT_SECRET as string).length < 24) throw new Error("JWT_SECRET precisa ter ao menos 24 caracteres em produção");
}

async function bootstrap() {
  assertProductionConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }); // rawBody: a assinatura do webhook do Instagram é do corpo cru

  // Webhook do WhatsApp com arquivo (PDF, foto) passa de 100 KB: limite maior só nessa rota, o resto segue com o padrão
  configureBodyParsers(app);

  // Atrás do proxy do Railway: confia só no último salto para que req.ip seja o IP real do cliente
  app.set("trust proxy", 1);
  // O painel está em outro domínio e a API pública é chamada por outros sites: recursos podem ser lidos entre origens
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

  // A API pública tem versionamento e prefixo próprios (/api/public/v1)
  app.setGlobalPrefix("api/v1", { exclude: [{ path: "api/public/v1/(.*)", method: RequestMethod.ALL }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Sessão por cookie: pedidos que alteram dados só valem vindos de um site do painel
  app.use(csrfOriginCheck());
  app.enableCors({
    origin: webOrigins(),
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
