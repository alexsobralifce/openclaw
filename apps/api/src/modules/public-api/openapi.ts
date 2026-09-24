import { SCOPES } from "./scopes";
import { WEBHOOK_EVENTS } from "../webhooks/webhooks.service";

const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const str = (extra: any = {}) => ({ type: "string", ...extra });
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema: any) => ({ content: { "application/json": { schema } } });
const ok = (schema: any, description = "Sucesso") => ({ description, ...json(schema) });
const list = (item: string) => obj({ data: { type: "array", items: ref(item) }, nextCursor: str({ nullable: true }) });
const idParam = { name: "id", in: "path", required: true, schema: str() };
const pageParams = [
  { name: "cursor", in: "query", schema: str() },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "updatedSince", in: "query", description: "Só itens atualizados depois desta data (ISO 8601)", schema: str({ format: "date-time" }) },
];
const idemHeader = { name: "Idempotency-Key", in: "header", description: "8 a 128 caracteres. Repetir a mesma requisição com a mesma chave devolve a resposta original.", schema: str() };

const op = (summary: string, scope: string | null, extra: any = {}) => ({
  summary,
  ...(scope ? { description: `Escopo necessário: \`${scope}\`` } : {}),
  ...(scope === null ? { security: [] } : {}),
  responses: { "401": ref401, "403": ref403, "429": ref429, ...(extra.responses ?? {}) },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "responses")),
});
const ref401 = { description: "Chave ausente, inválida, expirada ou revogada", ...json(ref("Error")) };
const ref403 = { description: "Escopo insuficiente ou limite do plano", ...json(ref("Error")) };
const ref429 = { description: "Limite de requisições excedido (veja Retry-After)", ...json(ref("Error")) };

export function openApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "API pública do openclaw",
      version: "1.0.0",
      description:
        "Integre CRM, site, BI, e-mail, agenda e WhatsApp ao openclaw. Autentique com `Authorization: Bearer oc_live_…` (crie a chave no painel, com os escopos mínimos necessários). Listas usam paginação por cursor (`nextCursor`) e ordenam por atualização crescente. Erros: `{ error: { code, message } }`.\n\n**Webhooks:** cada entrega leva `X-OpenClaw-Signature: t=<unix>,v1=<HMAC-SHA256 hex de \"t.corpo\" com o segredo whsec_…>`. Rejeite entregas com `t` muito antigo (recomendado: 5 minutos).",
    },
    servers: [{ url: "/api/public/v1" }],
    security: [{ bearer: [] }],
    tags: ["Meta", "Contatos", "Conversas", "WhatsApp", "E-mail", "Agenda", "Webhooks"].map((name) => ({ name })),
    paths: {
      "/health": { get: { tags: ["Meta"], ...op("Verifica se a API está no ar", null, { responses: { "200": ok(obj({ status: str() })) } }) } },
      "/me": { get: { tags: ["Meta"], ...op("Workspace e escopos da chave", "qualquer", { responses: { "200": ok(obj({ workspace: obj({ id: str(), name: str(), plan: str() }), scopes: { type: "array", items: str() } })) } }) } },

      "/contacts": {
        get: { tags: ["Contatos"], ...op("Lista contatos", "contacts:read", { parameters: [...pageParams, { name: "search", in: "query", schema: str() }], responses: { "200": ok(list("Contact")) } }) },
        post: { tags: ["Contatos"], ...op("Cria um contato", "contacts:write", { requestBody: { required: true, ...json(ref("ContactInput")) }, responses: { "200": ok(ref("Contact")), "409": { description: "Telefone ou e-mail já cadastrado", ...json(ref("Error")) } } }) },
      },
      "/contacts/by-phone/{phone}": {
        put: { tags: ["Contatos"], ...op("Cria ou atualiza o contato pelo telefone (idempotente)", "contacts:write", { parameters: [{ name: "phone", in: "path", required: true, schema: str(), description: "Formato internacional, ex.: 5585999999999" }], requestBody: { required: true, ...json(ref("ContactInput")) }, responses: { "200": ok(ref("Contact")) } }) },
      },
      "/contacts/{id}": {
        get: { tags: ["Contatos"], ...op("Detalhe do contato (com tags)", "contacts:read", { parameters: [idParam], responses: { "200": ok(ref("Contact")), "404": { description: "Não encontrado", ...json(ref("Error")) } } }) },
        patch: { tags: ["Contatos"], ...op("Atualiza um contato", "contacts:write", { parameters: [idParam], requestBody: { required: true, ...json(ref("ContactInput")) }, responses: { "200": ok(ref("Contact")) } }) },
      },

      "/conversations": { get: { tags: ["Conversas"], ...op("Lista conversas", "conversations:read", { parameters: [...pageParams, { name: "status", in: "query", schema: str({ enum: ["OPEN", "PENDING", "RESOLVED", "SNOOZED"] }) }], responses: { "200": ok(list("Conversation")) } }) } },
      "/conversations/{id}": {
        get: { tags: ["Conversas"], ...op("Detalhe da conversa", "conversations:read", { parameters: [idParam], responses: { "200": ok(ref("Conversation")) } }) },
        patch: { tags: ["Conversas"], ...op("Altera o status da conversa", "conversations:write", { parameters: [idParam], requestBody: { required: true, ...json(obj({ status: str({ enum: ["OPEN", "PENDING", "RESOLVED", "SNOOZED"] }) }, ["status"])) }, responses: { "200": ok(ref("Conversation")) } }) },
      },
      "/conversations/{id}/messages": { get: { tags: ["WhatsApp"], ...op("Mensagens da conversa", "messages:read", { parameters: [idParam, ...pageParams], responses: { "200": ok(list("Message")) } }) } },
      "/messages": {
        post: {
          tags: ["WhatsApp"],
          ...op("Envia uma mensagem de WhatsApp", "messages:send", {
            parameters: [idemHeader],
            requestBody: { required: true, ...json(obj({ to: str({ description: "Telefone internacional, ex.: 5585999999999" }), text: str({ maxLength: 4096 }), channelId: str() }, ["to", "text"])) },
            responses: { "200": ok(obj({ id: str(), conversationId: str(), contactId: str(), status: str(), createdAt: str({ format: "date-time" }) })), "400": { description: "Sem canal de WhatsApp ativo ou número inválido", ...json(ref("Error")) } },
          }),
        },
      },

      "/email/accounts": { get: { tags: ["E-mail"], ...op("Contas Google conectadas", "email:read", { responses: { "200": ok(obj({ data: { type: "array", items: str() } })) } }) } },
      "/email/messages": { get: { tags: ["E-mail"], ...op("Busca e-mails (sintaxe do Gmail)", "email:read", { parameters: [{ name: "account", in: "query", schema: str() }, { name: "q", in: "query", schema: str(), description: "Ex.: is:unread from:fulano" }, { name: "limit", in: "query", schema: { type: "integer", maximum: 25 } }], responses: { "200": ok(obj({ data: { type: "array", items: ref("EmailSummary") } })) } }) } },
      "/email/messages/{id}": { get: { tags: ["E-mail"], ...op("Lê um e-mail", "email:read", { parameters: [idParam, { name: "account", in: "query", schema: str() }], responses: { "200": ok(ref("Email")) } }) } },
      "/email/send": {
        post: {
          tags: ["E-mail"],
          ...op("Envia um e-mail (1 destinatário; limite por hora)", "email:send", {
            parameters: [idemHeader],
            requestBody: { required: true, ...json(obj({ to: str({ format: "email" }), subject: str({ maxLength: 200 }), text: str({ maxLength: 20000 }), account: str({ format: "email" }) }, ["to", "subject", "text"])) },
            responses: { "200": ok(obj({ status: str() })) },
          }),
        },
      },

      "/calendar/events": {
        get: { tags: ["Agenda"], ...op("Lista eventos (máx. 92 dias)", "calendar:read", { parameters: [{ name: "from", in: "query", required: true, schema: str({ format: "date-time" }) }, { name: "to", in: "query", required: true, schema: str({ format: "date-time" }) }, { name: "account", in: "query", schema: str() }], responses: { "200": ok(obj({ data: { type: "array", items: ref("Event") } })) } }) },
        post: {
          tags: ["Agenda"],
          ...op("Cria um evento", "calendar:write", {
            parameters: [idemHeader],
            requestBody: { required: true, ...json(obj({ title: str(), start: str({ format: "date-time" }), end: str({ format: "date-time" }), description: str(), attendees: { type: "array", maxItems: 20, items: str({ format: "email" }) }, account: str({ format: "email" }) }, ["title", "start", "end"])) },
            responses: { "200": ok(obj({ id: str(), link: str() })) },
          }),
        },
      },

      "/webhooks": {
        get: { tags: ["Webhooks"], ...op("Lista webhooks", "webhooks:manage", { responses: { "200": ok(obj({ data: { type: "array", items: ref("Webhook") } })) } }) },
        post: {
          tags: ["Webhooks"],
          ...op("Cria um webhook (o segredo é mostrado uma única vez)", "webhooks:manage", {
            requestBody: { required: true, ...json(obj({ url: str({ description: "https público" }), events: { type: "array", items: str({ enum: [...WEBHOOK_EVENTS.filter((e) => e !== "webhook.test"), "*"] }) } }, ["url"])) },
            responses: { "200": ok({ allOf: [ref("Webhook"), obj({ secret: str() })] }) },
          }),
        },
      },
      "/webhooks/{id}": { delete: { tags: ["Webhooks"], ...op("Remove um webhook", "webhooks:manage", { parameters: [idParam], responses: { "200": ok(obj({ ok: { type: "boolean" } })) } }) } },
      "/webhooks/{id}/test": { post: { tags: ["Webhooks"], ...op("Envia um evento de teste", "webhooks:manage", { parameters: [idParam], responses: { "200": ok(obj({ ok: { type: "boolean" } })) } }) } },
      "/webhooks/{id}/deliveries": { get: { tags: ["Webhooks"], ...op("Últimas entregas", "webhooks:manage", { parameters: [idParam], responses: { "200": ok(obj({ data: { type: "array", items: ref("Delivery") } })) } }) } },
      "/webhooks/{id}/deliveries/{deliveryId}/retry": { post: { tags: ["Webhooks"], ...op("Reenvia uma entrega", "webhooks:manage", { parameters: [idParam, { name: "deliveryId", in: "path", required: true, schema: str() }], responses: { "200": ok(obj({ ok: { type: "boolean" } })) } }) } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: `Escopos disponíveis: ${SCOPES.join(", ")}` } },
      schemas: {
        Error: obj({ error: obj({ code: str(), message: str() }) }),
        Contact: obj({ id: str(), name: str(), email: str({ nullable: true }), phone: str({ nullable: true }), externalId: str({ nullable: true }), notes: str({ nullable: true }), createdAt: str({ format: "date-time" }), updatedAt: str({ format: "date-time" }) }),
        ContactInput: obj({ name: str(), email: str({ format: "email" }), phone: str(), externalId: str(), notes: str() }),
        Conversation: obj({ id: str(), status: str(), subject: str({ nullable: true }), contactId: str(), channelId: str(), createdAt: str({ format: "date-time" }), updatedAt: str({ format: "date-time" }) }),
        Message: obj({ id: str(), conversationId: str(), body: str(), type: str(), direction: str({ enum: ["INBOUND", "OUTBOUND"] }), createdAt: str({ format: "date-time" }) }),
        EmailSummary: obj({ id: str(), from: str(), subject: str(), date: str(), snippet: str(), receivedAt: str({ format: "date-time" }) }),
        Email: obj({ id: str(), from: str(), to: str(), subject: str(), date: str(), body: str() }),
        Event: obj({ id: str(), title: str(), start: str(), end: str(), location: str({ nullable: true }) }),
        Webhook: obj({ id: str(), url: str(), events: { type: "array", items: str() }, isActive: { type: "boolean" }, failureCount: { type: "integer" }, createdAt: str({ format: "date-time" }) }),
        Delivery: obj({ id: str(), eventId: str(), type: str(), status: str({ enum: ["PENDING", "SUCCESS", "FAILED"] }), attempts: { type: "integer" }, responseCode: { type: "integer", nullable: true }, lastError: str({ nullable: true }), nextAttemptAt: str({ format: "date-time" }), createdAt: str({ format: "date-time" }) }),
      },
    },
  };
}
