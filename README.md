# openclaw

Plataforma de atendimento multi-tenant: **inbox de conversas do WhatsApp**, **automações**, **API pública com webhooks** e um **assistente pessoal no WhatsApp** que lê e responde e-mails, consulta a agenda e atende clientes por texto ou voz, inclusive no carro (Android Auto e CarPlay).

> **Status:** projeto em fase de testes, sem clientes reais. Veja [Limitações conhecidas](#limitações-conhecidas) e [docs/operacao.md](docs/operacao.md).

## O que já funciona

| Área | O que faz |
|---|---|
| **Inbox** | Conversas e contatos do WhatsApp (via [Evolution API](https://github.com/EvolutionAPI/evolution-api)), em tempo real por Socket.IO. Trata texto, respostas, documentos, vídeo, figurinhas, localização, contatos e enquetes. |
| **Automações** | Regras "quando chegar mensagem, se…, então…": responder ao cliente, avisar o dono, etiquetar, mudar status. Condições por texto, tipo de mensagem e horário comercial; controle de frequência. |
| **Assistente no WhatsApp** | O dono conversa com o próprio WhatsApp conectado: menu por número ou palavra, IA para pedidos livres, transcrição de áudio (Gemini, com Whisper de reserva), resposta falada, memória de preferências. Ações que mudam o mundo (enviar e-mail, criar evento, responder cliente) sempre pedem confirmação. Guia completo: [`apps/web/public/comandos.html`](apps/web/public/comandos.html). |
| **E-mail e agenda** | Gmail e Google Agenda de várias contas. Novos e-mails entram numa **fila em ordem de chegada**; "próximo" trata um a um. |
| **Modo carro** | Respostas em texto curto e falável, com escolha por voz ("a segunda", "a da Maria"). Liga com "modo carro" e desliga sozinho. |
| **API pública** | `/api/public/v1`: chaves com escopos, contatos, conversas, mensagens, e-mail e agenda, idempotência, limites por plano, [OpenAPI](#api-pública). |
| **Webhooks de saída** | Entrega assinada (HMAC), com fila, tentativas com espera crescente, proteção contra SSRF e desativação automática de endpoints com falha. |
| **Usuários e permissões** | Cada cadastro tem o próprio workspace e fica **pendente** até um root/admin aprovar e liberar os serviços. Quem administra não vê o conteúdo dos workspaces. |

## Arquitetura

Monorepo [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build).

```
apps/
  api/        API NestJS (REST, Socket.IO, filas e vigias em segundo plano)
  web/        Painel Next.js 15 + React 19 + Tailwind
  widget/     Protótipo de widget de chat embutível (o canal webchat ainda não existe no backend)
packages/
  database/   Schema Prisma + cliente (PostgreSQL)
  types/      Tipos compartilhados
docs/         Documentação
```

**Como uma mensagem de cliente é processada:**

```
WhatsApp ─► Evolution API ─► POST /api/v1/channels/webhooks/whatsapp/:instância
                                   │  (só valida o segredo, grava na fila e responde 200)
                                   ▼
                        tabela InboundEvent  ◄── deduplica por instância + id da mensagem
                                   │  worker em ordem de chegada, com nova tentativa
                                   ▼
        é um usuário do sistema?  ──sim──►  assistente (menu, IA, e-mail, agenda)
                                   │não
                                   ▼
        contato + conversa + mensagem ─► Socket.IO (painel) + webhooks de saída + automações
```

**Decisões que valem saber:**

- **Estado e filas ficam no PostgreSQL** (tabelas `InboundEvent`, `WebhookDelivery`, `KvEntry`), não em memória nem no Redis. Assim sobrevivem a reinícios e funcionam com mais de uma instância.
- **Permissões por serviço:** `inbox`, `contacts`, `channels`, `assistant`, `email`, `calendar`, `automations`, `api`. O root tem todos; os demais só o que foi liberado, checado a cada requisição (desativar uma conta corta o acesso na hora).
- **Segredos em repouso são cifrados** (AES-256-GCM): segredos de webhooks e tokens do Google. A chave deriva de `WEBHOOK_SECRET`; **trocá-lo torna esses dados ilegíveis**.

## Rodando localmente

**Requisitos:** Node 20+, pnpm, Docker.

```bash
pnpm install

# Postgres (5433), Redis (6380) e Evolution API (8082) para desenvolvimento
docker compose -f docker-compose.dev.yml up -d

# Variáveis: o modelo já vem com os valores do docker-compose.dev.yml (a API lê apps/api/.env).
# Preencha OPENAI_API_KEY para o assistente livre e as GOOGLE_* para Gmail/Agenda, se for usar.
cp .env.example apps/api/.env

# Schema do banco. O Prisma CLI não lê o .env da API e o `turbo` não repassa variáveis:
# exporte a URL e rode pelo pacote, sem passar pelo `pnpm db:push` da raiz.
export DATABASE_URL="postgresql://openclaw:openclaw@localhost:5433/openclaw"
pnpm --filter @openclaw/database db:generate
pnpm --filter @openclaw/database db:push

pnpm dev        # API em :3001 e painel em :3000
```

O **primeiro usuário cadastrado** em `/auth/register` vira **root** e entra direto. Os seguintes ficam pendentes até você aprovar em **Usuários**.

Para conectar o WhatsApp: **Canais → WhatsApp**, escaneie o QR code. Para o assistente responder a você, cadastre o seu número em **Configurações**.

### Comandos úteis

```bash
pnpm typecheck                         # tipos em todos os pacotes
pnpm build                             # build de tudo
pnpm --filter @openclaw/api test       # testes da API (vitest)
pnpm --filter @openclaw/database db:studio   # Prisma Studio
```

## Variáveis de ambiente

Modelo completo em [`.env.example`](.env.example). As principais:

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | PostgreSQL |
| `JWT_SECRET` | sim em produção (24+ caracteres) | Assinatura dos logins |
| `WEBHOOK_SECRET` | sim em produção | Valida o webhook do Evolution e **cifra os segredos** |
| `WEB_URL`, `API_URL` | sim | CORS e links |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | para WhatsApp | Evolution API |
| `OPENAI_API_KEY` | para o assistente livre | IA de comandos e resumos (`OPENAI_MODEL`) |
| `GEMINI_API_KEY` | opcional | Transcrição e voz |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | para Gmail/Agenda | OAuth do Google |
| `ROOT_EMAIL` | opcional | Quem vira root numa instalação já existente |

Em produção a API se recusa a subir sem `DATABASE_URL`, `JWT_SECRET` e `WEBHOOK_SECRET`.

## API pública

Base: `/api/public/v1` · autenticação `Authorization: Bearer <chave>` · chaves criadas em **API** no painel.

- Especificação: `GET /api/public/v1/openapi.json`
- Escopos: `contacts:*`, `conversations:*`, `messages:*`, `email:*`, `calendar:*`, `webhooks:manage`
- Envios aceitam `Idempotency-Key`
- Limites por plano (`FREE`, `STARTER`, `GROWTH`, `ENTERPRISE`): chaves, webhooks e requisições por minuto
- Uma chave só vale se o **dono do workspace** tem o serviço liberado

**Webhooks de saída:** eventos `message.received`, `message.sent`, `conversation.created`, `conversation.status_changed`, `contact.created`, `contact.updated`, `email.received`. Cada entrega leva o cabeçalho `X-OpenClaw-Signature: t=<unix>,v1=<hmac-sha256>`, calculado sobre `"<t>.<corpo>"` com o segredo do endpoint.

Mais detalhes em [docs/api-publica.md](docs/api-publica.md) e na página `/api-publica.html` do painel.

## Deploy (Railway)

Cada serviço é publicado a partir do código local, com Dockerfile próprio:

```bash
railway up --service api --detach    # Dockerfile.api
railway up --service web --detach    # Dockerfile.web
```

- Ao iniciar, o container da API roda `prisma db push` e depois sobe. **Use só mudanças aditivas no schema:** uma restrição única em coluna nova faz o `db push` abortar e a API não sobe.
- **Healthcheck:** API em `/api/v1/health` (só banco) e painel em `/auth/login`. Um deploy que não responde não substitui a versão no ar.
- **Monitor:** `.github/workflows/monitor.yml` consulta `/api/v1/health/full` (banco, Evolution, WhatsApp do root conectado, fila de entrada parada).
- Serviços no projeto: `api`, `web`, `evolution` (imagem `evoapicloud/evolution-api`), dois PostgreSQL (API e Evolution) e Redis (usado só pelo Evolution).

## Segurança

- Login com limite por IP e bloqueio temporário por conta; cadastro público limitado e com aprovação obrigatória.
- `helmet` na API e cabeçalhos de segurança no painel.
- O assistente trata e-mails e mensagens de clientes como **dados não confiáveis** (defesa contra prompt injection) e nunca executa ação sensível sem confirmação do dono.
- Webhooks de saída bloqueiam destinos internos (SSRF).

## Limitações conhecidas

- **Sem backup automático do banco.** Obrigatório antes de haver clientes reais; o checklist está em [docs/operacao.md](docs/operacao.md) (a API avisa no log ao passar de 5 usuários ativos).
- Instagram (DMs de texto, com envio e recebimento) está implementado, mas depende da aprovação do App Review da Meta para atender contas de terceiros; setup em [docs/instagram.md](docs/instagram.md). O envio de mídia e a resposta a comentários não existem (mídia recebida vira só texto + link). Facebook e webchat existem no schema, mas **não têm implementação**; Stripe e Resend estão só no `.env.example`.
- Áudios e anexos de clientes não são baixados nem transcritos (só os comandos do dono).
- Listas do inbox sem paginação e sem busca.
- Migrações via `prisma db push`, sem histórico versionado.
- Testes cobrem a lógica principal (67); não há testes de integração automatizados nem CI.
