# Operação

## Antes de ter clientes reais

- **Backup do Postgres — obrigatório quando passar de 5 usuários ativos.** Hoje o projeto é
  de teste e não há cópia dos dados. Ao passar de 5 usuários, configurar `pg_dump` diário para
  armazenamento externo (Cloudflare R2/S3), retenção de 14–30 dias, e testar a restauração.
  Incluir o Postgres do Evolution (senão a sessão do WhatsApp precisa de novo QR code).
  A API registra um aviso no log toda vez que um usuário é aprovado acima desse número.

## Monitoramento

| O quê | Como |
|---|---|
| Healthcheck do Railway | `GET /api/v1/health` (só banco) na API; `/auth/login` no painel. Um deploy que não responde **não substitui** o que está no ar. |
| Monitor externo | `.github/workflows/monitor.yml` chama `GET /api/v1/health/full` a cada 30 min. |
| O que o `/health/full` verifica | banco, Evolution, WhatsApp do root conectado, mensagens paradas na fila de entrada (> 10 min) |
| Resposta | `200 {"status":"ok"}` ou `503 {"status":"degraded","failing":["whatsapp-desconectado"]}` |

Valores de `failing`: `db`, `evolution`, `whatsapp-desconectado`, `fila-de-entrada`.

Variáveis opcionais do repositório (Settings → Variables): `API_URL`, `WEB_URL`.
