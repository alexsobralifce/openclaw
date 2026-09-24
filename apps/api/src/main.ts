import { NestFactory } from "@nestjs/core";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = ["DATABASE_URL", "JWT_SECRET", "WEBHOOK_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Variáveis obrigatórias ausentes em produção: ${missing.join(", ")}`);
  if ((process.env.JWT_SECRET as string).length < 24) throw new Error("JWT_SECRET precisa ter ao menos 24 caracteres em produção");
}

async function bootstrap() {
  assertProductionConfig();
  const app = await NestFactory.create(AppModule);

  // A API pública tem versionamento e prefixo próprios (/api/public/v1)
  app.setGlobalPrefix("api/v1", { exclude: [{ path: "api/public/v1/(.*)", method: RequestMethod.ALL }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.WEB_URL || "http://localhost:3000",
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
