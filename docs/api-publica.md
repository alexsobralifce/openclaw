# API pública do openclaw

> **Status: implementada (fases 1 a 4).** O que ainda falta está em [Pendências](#pendências).
> Fonte de verdade dos contratos: `GET /api/public/v1/openapi.json` (público).
> Painel: menu **API** (`/dashboard/api`) para chaves e webhooks · guia visual em `/api-publica.html`.

## Para quem é

Clientes do openclaw (multi-tenant). Cada workspace cria e gerencia as próprias chaves para integrar CRM, site, BI, e-mail (Gmail), agenda (Google Agenda) e WhatsApp.

A API pública fica sob **`/api/public/v1`**, no mesmo app da API do painel (`/api/v1`, autenticada por JWT), reaproveitando os serviços de domínio.

```
Sistema externo ─► /api/public/v1/* ─► ApiKeyGuard ─► escopo ─► serviços do dono ─► limite por minuto ─► serviço de domínio
openclaw ─► tabela WebhookDelivery ─► entregador (a cada 5 s) ─► URL do cliente (assinada com HMAC)
```

## Autenticação e segurança

- `Authorization: Bearer oc_live_<aleatório>`. A chave é mostrada **uma vez**; no banco ficam só o hash SHA-256 e o prefixo (12 caracteres).
- **Escopos por chave** (menor privilégio). O `workspaceId` vem da chave, nunca do cliente. Nenhum escopo vem por padrão.
- **A chave herda as restrições do dono do workspace:** só vale se a conta dele está ativa e tem liberados o serviço `api` (exigido de **toda** chave) e o serviço do escopo usado: `contacts:*` exige `contacts`; `conversations:*` e `messages:*`, `inbox`; `email:*`, `email`; `calendar:*`, `calendar`. Sem isso, `403`.
- **Limite por minuto** por chave (`429` com `Retry-After`), contado no banco, então vale entre várias instâncias.
- **Idempotência** opcional com `Idempotency-Key` (veja abaixo).
- Chaves podem ter **expiração** e podem ser **revogadas** a qualquer momento.
- **E-mail e agenda são dados sensíveis**: escopos separados, sem rotas de exclusão, envio de e-mail sempre registrado no log.

### Escopos

`contacts:read`, `contacts:write`, `conversations:read`, `conversations:write`, `messages:read`, `messages:send`, `email:read`, `email:send`, `calendar:read`, `calendar:write`, `webhooks:manage`.

## Endpoints

| Recurso | Rotas | Escopos |
|---|---|---|
| Meta | `GET /health`, `GET /me`, `GET /openapi.json` | (`/health` e `/openapi.json` são públicos; `/me` aceita qualquer chave) |
| Contatos | `GET /contacts`, `POST /contacts`, `GET /contacts/:id`, `PATCH /contacts/:id`, `PUT /contacts/by-phone/:phone` (upsert) | `contacts:read`, `contacts:write` |
| Conversas | `GET /conversations`, `GET /conversations/:id`, `PATCH /conversations/:id` (status e atribuição) | `conversations:read`, `conversations:write` |
| Mensagens (WhatsApp) | `GET /conversations/:id/messages`, `POST /messages` (**só texto**) | `messages:read`, `messages:send` |
| E-mail | `GET /email/accounts`, `GET /email/messages?account=&q=&limit=`, `GET /email/messages/:id`, `POST /email/send` | `email:read`, `email:send` |
| Agenda | `GET /calendar/events?from=&to=&account=`, `POST /calendar/events` | `calendar:read`, `calendar:write` |
| Webhooks | `GET /webhooks`, `POST /webhooks`, `DELETE /webhooks/:id`, `POST /webhooks/:id/test`, `GET /webhooks/:id/deliveries`, `POST /webhooks/:id/deliveries/:deliveryId/retry` | `webhooks:manage` |

### Convenções

- **Paginação por cursor** em contatos, conversas e mensagens: `?cursor=&limit=` (padrão 50, máximo 100). A resposta é `{ "data": [...], "nextCursor": "<id>" | null }`: passe o `nextCursor` no pedido seguinte até ele vir `null`.
- **Leitura incremental** (para BI): `?updatedSince=<ISO 8601>`.
- **Erros:** `{ "error": { "code": "...", "message": "..." } }`. Erros de validação juntam as mensagens; erros internos nunca vazam detalhes.
- IDs opacos, datas ISO 8601 em UTC, versão na URL.

### Idempotência

Cabeçalho `Idempotency-Key` (8 a 128 caracteres visíveis) em `POST /messages`, `POST /email/send` e `POST /calendar/events`. É **opcional**, mas recomendado em qualquer envio.

- Repetir a mesma requisição devolve a resposta original, com `Idempotent-Replayed: true`.
- Mesma chave com corpo diferente: `422`. Requisição idêntica ainda em andamento: `409`.
- Os registros expiram em 24 h. Se a execução falhar, a chave é liberada para nova tentativa.

## Webhooks de saída

- **Eventos:** `message.received`, `message.sent`, `conversation.created`, `conversation.status_changed`, `conversation.deleted`, `contact.created`, `contact.updated`, `email.received` (só metadados: conta, id, remetente e assunto), `webhook.test`. Use `*` para receber todos.
- **Cabeçalhos:** `X-OpenClaw-Event`, `X-OpenClaw-Delivery`, `X-OpenClaw-Signature: t=<unix>,v1=<HMAC-SHA256(segredo, "t.corpo")>`.
- **Corpo:** `{ id, type, createdAt, data }`. Quem recebe deve deduplicar pelo `id` e recusar assinaturas com `t` muito antigo (sugestão: 5 minutos).
- O segredo `whsec_…` aparece **uma vez**, na criação, e fica cifrado (AES-256-GCM) no banco.
- **Fila no banco** (tabela `WebhookDelivery`, verificada a cada 5 s), sem depender de Redis; sobrevive a reinícios.
- **Tentativas:** após 1 min, 5 min, 30 min, 2 h e 12 h; depois a entrega fica `FAILED`. Depois de 10 entregas falhas seguidas o endpoint é desativado (reativa ao reenviar uma entrega).
- **Proteção SSRF:** só `https` em produção, sem credenciais na URL, bloqueio de endereços internos (10.x, 127.x, 192.168.x, 169.254.x, IPv6 local) e sem seguir redirecionamentos.

## E-mail e agenda

- O parâmetro `account` escolhe uma das contas Google conectadas pelo cliente; sem ele, usa a primeira.
- **Proteções:** e-mail com um único destinatário e sem quebras de linha no assunto (evita injeção de cabeçalhos); teto de envios por hora por chave (`API_EMAIL_SEND_PER_HOUR`, padrão 30); intervalo máximo de 92 dias na agenda; até 20 convidados por evento.
- **Auditoria:** cada chamada de e-mail e agenda registra chave, workspace, ação e conta no log (`[AUDIT-API]`), sem o conteúdo dos e-mails.
- Erros do Google viram mensagens genéricas (`404`, `400` ou `502`).

## Limites por plano

Definidos em `apps/api/src/modules/public-api/plan-limits.ts`:

| Plano | Chaves | Webhooks | Requisições/min por chave |
|---|---|---|---|
| FREE | 2 | 2 | 60 |
| STARTER | 5 | 5 | 300 |
| GROWTH | 20 | 20 | 1000 |
| ENTERPRISE | 100 | 100 | 6000 |

Ao criar uma chave ou webhook além do limite do plano, `403` (chaves contam só as ativas); ao pedir para a chave um limite por minuto acima do plano, `400`.

## Painel e documentação

- **Painel** (`/dashboard/api`): criar e revogar chaves (escopos sensíveis destacados, chave mostrada uma vez); criar, testar e remover webhooks, ver as entregas e reenviar as que falharam. Usa as rotas JWT `/api/v1/api-keys` e `/api/v1/webhooks`.
- **OpenAPI 3.0**, escrito à mão em `openapi.ts` e servido em `GET /api/public/v1/openapi.json`. Ao criar uma rota, atualize esse arquivo.

## Modelo de dados

- `ApiKey`: `keyHash`, `prefix`, `scopes`, `rateLimit`, `expiresAt`, `revokedAt`, `lastUsed`, `workspaceId`.
- `WebhookEndpoint`: `url`, `secret` (cifrado), `events`, `isActive`, `failureCount`, `workspaceId`.
- `WebhookDelivery`: `endpointId`, `eventId`, `type`, `payload`, `status`, `attempts`, `responseCode`, `lastError`, `nextAttemptAt`.
- `IdempotencyKey`: `apiKeyId`, `key`, `requestHash`, `status`, `response`, `expiresAt` (24 h).

## Pendências

O que estava planejado e **ainda não existe** no código:

- Rotas `DELETE /contacts/:id` e `POST /contacts/:id/tags` (as tags já aparecem na leitura do contato).
- `GET /channels` (status dos canais) e `GET /reports/summary`.
- Envio de **mídia** em `POST /messages` (hoje só texto) e teto de envios por destinatário (risco de banimento do número).
- Evento de webhook `message.status`.
- Auditoria de **todas** as chamadas (hoje só e-mail e agenda).
- Formato de erro com campo `details`.
- Depois disso: SDKs (Node e Python), OAuth2 para apps de terceiros e uma `/v2`, se preciso.

## Riscos

- **Spam e banimento no WhatsApp:** por isso os tetos de envio e a idempotência; falta o teto por destinatário.
- **Vazamento de chave com escopo de e-mail:** mitigado por revogação fácil, expiração e log de auditoria; falta alerta de uso anômalo.
