# API pública do openclaw

> **Status: EM ANDAMENTO** — Fase 1 (núcleo) implementada; fases 2 a 4 pendentes.
> Antes de usar: rodar `pnpm db:push` (campos em `ApiKey` e tabelas `WebhookEndpoint`/`WebhookDelivery`).
> Página no painel: `/api-publica.html` (menu lateral › *API pública*).

## Decisões já tomadas

- **Público:** clientes do openclaw (multi-tenant). Cada workspace cria e gerencia as próprias chaves.
- **Sistemas a integrar:** CRM, site, BI, e-mails (Gmail), agenda (Google Agenda) e WhatsApp.

## Ponto de partida (código atual)

- API NestJS em `apps/api`, prefixo `/api/v1`, JWT só para o painel.
- O modelo `ApiKey` (`workspaceId`, `keyHash`, `lastUsed`) já existe no Prisma, mas nenhum código o usa.
- Webhooks de entrada da Evolution já usam `WEBHOOK_SECRET`.
- Google (Gmail/Agenda) já é integrado por workspace (`google.service.ts`, com vários e-mails por workspace).

## Arquitetura

Módulo novo `modules/public-api` no mesmo app, sob **`/api/public/v1`**, reaproveitando os serviços de domínio.

```
Sistema externo ─► /api/public/v1/* ─► ApiKeyGuard ─► Escopo ─► Rate limit ─► Serviço de domínio
openclaw ─► fila (Bull) ─► entregador de webhooks ─► URL do cliente (HMAC)
```

Separar em outro serviço só se a carga externa passar a competir com a do painel.

## Autenticação e segurança

- `Authorization: Bearer oc_live_<aleatório>`; mostrada **uma vez**; no banco só o hash SHA-256 + prefixo visível.
- **Escopos por chave** (menor privilégio). O `workspaceId` vem da chave, nunca do cliente.
- **Rate limit** por chave (`429` + `Retry-After`), por plano.
- **Idempotência**: `Idempotency-Key` obrigatório em `POST` que envia mensagem/e-mail.
- **Auditoria** de cada chamada; revogação, rotação e expiração opcional.
- **E-mail e agenda são dados sensíveis do cliente**: escopos separados e desligados por padrão, sem exclusão permanente, envio de e-mail sempre registrado.
- Envio de WhatsApp com teto por chave e por destinatário (risco de banimento do número).

## Recursos (v1)

| Recurso | Endpoints | Escopos |
|---|---|---|
| Meta | `GET /me`, `GET /health` | qualquer |
| Contatos (CRM) | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/:id`, `PUT /contacts/by-phone/:phone` (upsert), `POST /contacts/:id/tags` | `contacts:read`, `contacts:write` |
| Conversas | `GET /conversations`, `GET /conversations/:id`, `PATCH /conversations/:id` (status, atribuição) | `conversations:read`, `conversations:write` |
| WhatsApp | `GET /channels` (status), `GET /conversations/:id/messages`, `POST /messages` (texto/mídia) | `messages:read`, `messages:send` |
| E-mail (Gmail) | `GET /email/accounts`, `GET /email/messages?account=&q=`, `GET /email/messages/:id`, `POST /email/send` | `email:read`, `email:send` |
| Agenda | `GET /calendar/events?from=&to=&account=`, `POST /calendar/events` | `calendar:read`, `calendar:write` |
| Webhooks | `GET/POST/DELETE /webhooks`, `POST /webhooks/:id/test`, `GET /webhooks/:id/deliveries` | `webhooks:manage` |
| BI | leitura com `updatedSince` + cursor em contatos, conversas e mensagens; `GET /reports/summary` | `*:read` |

Convenções: paginação por cursor (`?cursor=&limit=`), filtro `updatedSince`, IDs opacos, datas ISO 8601 UTC, telefones E.164, erros `{ error: { code, message, details } }`, versão na URL.

## Webhooks de saída

- Eventos: `message.received`, `message.sent`, `message.status`, `conversation.created`, `conversation.status_changed`, `contact.created`, `contact.updated`, `email.received` (opcional).
- Assinatura: `X-OpenClaw-Signature: t=<timestamp>,v1=<HMAC-SHA256(segredo, t.corpo)>`, tolerância de 5 min.
- Entrega por fila Bull com retentativas exponenciais (1 min, 5 min, 30 min, 2 h, 12 h) e desativação após falhas seguidas.
- Log de entregas por endpoint, com reenvio. Corpo com `id`, `type`, `createdAt`, `data` (o receptor deduplica).

## Modelo de dados (adições)

- `ApiKey`: `prefix`, `scopes String[]`, `expiresAt`, `revokedAt`, `rateLimit`.
- `WebhookEndpoint`: `url`, `secret` (cifrado), `events String[]`, `isActive`, `failureCount`, `workspaceId`.
- `WebhookDelivery`: `endpointId`, `eventId`, `status`, `attempts`, `responseCode`, `nextAttemptAt`.
- `IdempotencyKey`: `key`, `apiKeyId`, `responseHash`, `expiresAt` (24 h).

## Integrações-alvo

- **CRM/ERP:** `PUT /contacts/by-phone` + webhook `conversation.status_changed`.
- **Site/pedidos:** `POST /messages` transacional.
- **BI:** leitura incremental por `updatedSince`.
- **E-mail/Agenda:** clientes leem e enviam pela conta Google que conectaram (parâmetro `account`).
- **n8n/Zapier/Make:** chave de API + webhooks.

## Documentação e DX

OpenAPI 3.1 (`@nestjs/swagger`) em `/api/public/docs`; seção "API" no painel para chaves e webhooks; exemplos curl/Node/Python; coleção Postman.

## Plano de entrega

1. **Fase 1 — núcleo (FEITA, exceto OpenAPI e tags/exclusão de contato):** `ApiKeyGuard` + escopos, criar/revogar chaves, `/me`, contatos, conversas, `POST /messages`, rate limit, OpenAPI.
2. **Fase 2 — eventos (FEITA; `message.status` pendente):** endpoints de webhook, fila, HMAC, retentativas, log de entregas.
3. **Fase 3 — e-mail e agenda (FEITA):** rotas `email/*` e `calendar/*` sobre `google.service`, escopos sensíveis, auditoria reforçada.
4. **Fase 4 — painel e endurecimento:** tela de chaves/webhooks, idempotência, cotas por plano, testes de carga.
5. **Depois:** SDKs Node/Python, OAuth2 para apps de terceiros, `/v2` se preciso.

## Riscos

- Spam/banimento no WhatsApp: tetos de envio e exigência de conversa iniciada ou consentimento.
- Limites por plano (Básico R$ 70) precisam valer também na API.
- Segredos de webhook cifrados em repouso.
- Vazamento de chave com escopo de e-mail: rotação fácil, expiração e alerta de uso anômalo.

## Webhooks de saída — como ficou (Fase 2)

- Escopo `webhooks:manage`. Rotas em `/api/public/v1/webhooks`: `GET`, `POST`, `DELETE /:id`, `POST /:id/test`, `GET /:id/deliveries`, `POST /:id/deliveries/:deliveryId/retry`.
- O segredo `whsec_…` aparece **uma vez** na criação; fica cifrado (AES-256-GCM) no banco.
- Eventos: `message.received`, `message.sent`, `conversation.created`, `conversation.status_changed`, `contact.created`, `contact.updated`, `webhook.test` (ou `*` para todos).
- Cabeçalhos: `X-OpenClaw-Event`, `X-OpenClaw-Delivery`, `X-OpenClaw-Signature: t=<unix>,v1=<HMAC-SHA256(segredo, "t.corpo")>`.
- Fila **no banco** (tabela `WebhookDelivery`, verificada a cada 5 s), sem depender de Redis; sobrevive a reinícios.
- Retentativas após 1 min, 5 min, 30 min, 2 h e 12 h; depois a entrega fica `FAILED`. Após 10 entregas falhas seguidas o endpoint é desativado (reativa ao reenviar uma entrega).
- Proteção SSRF: só `https` (em produção), sem credenciais na URL, bloqueio de endereços internos (10.x, 127.x, 192.168.x, 169.254.x, IPv6 local), sem seguir redirecionamentos.

## E-mail e agenda — como ficou (Fase 3)

- Escopos `email:read`, `email:send`, `calendar:read`, `calendar:write`. **Nenhum vem por padrão**: o cliente escolhe ao criar a chave.
- Rotas: `GET /email/accounts`, `GET /email/messages?account=&q=&limit=`, `GET /email/messages/:id`, `POST /email/send`, `GET /calendar/events?from=&to=&account=`, `POST /calendar/events`. Sem rotas de exclusão.
- O parâmetro `account` escolhe uma das contas Google conectadas; sem ele, usa a primeira.
- Proteções: e-mail com um único destinatário e sem quebras de linha no assunto (evita injeção de cabeçalhos), teto de envios por hora por chave (`API_EMAIL_SEND_PER_HOUR`, padrão 30), intervalo máximo de 92 dias na agenda, até 20 convidados por evento.
- Auditoria: cada chamada registra chave, workspace, ação e conta no log (`[AUDIT-API]`), sem o conteúdo dos e-mails.
- Erros do Google viram mensagens genéricas (404, 400 ou 502), sem vazar detalhes internos.
- Novo evento de webhook `email.received` (só metadados: conta, id, remetente, assunto), emitido pelo vigia de e-mails.
