# CLAUDE.md

## Codebase Overview

Assist.IA (repositório `openclaw`): plataforma de inbox multi-tenant (WhatsApp via Evolution API e Instagram) com um assistente pessoal por WhatsApp (e-mail, agenda, Drive, cofre de senhas, clima). Postgres guarda também estado, filas e cache (não há Redis em uso). Comentários, mensagens e logs em pt-BR.

**Stack**: pnpm 12.6 + Turborepo, NestJS 10 (`apps/api`), Next.js 15 / React 19 / Tailwind 3 (`apps/web`), Prisma 6 (`packages/database`), Vitest, Railway.
**Estrutura**: `apps/api/src/modules/*` (channels é o maior; o assistente vive em `channels/assistant/`), `apps/web/src`, `packages/{database,types}`, `docs/`.

Para arquitetura, fluxos, gotchas e guia de navegação, veja [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Comandos

- Testes: `cd apps/api && pnpm test` (a raiz não tem tarefa `test`).
- Typecheck: `pnpm typecheck`. Prisma: `pnpm --filter @openclaw/database db:generate|db:push` (com `DATABASE_URL` exportada; o turbo não repassa env).
- Deploy manual: `railway up --service api --detach` e `railway up --service web --detach`.

## Regras que não são óbvias

- Coluna nova no Prisma: sem `@unique` (o `db push` roda no boot e trava a API); usar índice comum e garantir unicidade no código.
- Não trocar `WEBHOOK_SECRET` depois de definido (cifra segredos de webhook e tokens do Google).
- Toda consulta filtra por `workspaceId`. Rota nova da API pública exige atualizar `openapi.ts` (escrito à mão).
- `MenuService.respond`: a ordem das regras importa; telas `_input` só aceitam comandos globais como mensagem inteira.
