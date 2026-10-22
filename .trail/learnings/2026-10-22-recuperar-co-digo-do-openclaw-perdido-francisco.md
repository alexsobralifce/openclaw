---
title: Recuperar código do OpenClaw perdido (Railway sem commit) e deploy na e2-micro
author: Francisco
date: 2026-10-22
branch: recuperado
cost: { minutes: 148, tokens: 1361971 }
touches:
  - Dockerfile.api
  - apps/api/src/modules/channels/channels.module.ts
  - apps/api/src/modules/automations/automations.module.ts
  - deploy/Caddyfile
  - deploy/docker-compose.yml
  - apps/api/src/modules/auth/auth.controller.ts
  - apps/api/src/modules/automations/automation-runner.service.ts
  - apps/api/src/modules/channels/app-chat/app-chat.controller.ts
  - apps/api/src/modules/channels/app-chat/app-chat.service.ts
  - apps/api/src/modules/channels/assistant/assistant-scheduler.service.ts
---

## Decided
- O código do deploy de 13/10 só existia no Railway (enviado por `railway up`, sem commit; o GitHub parou em 24/09). Reconstruído reaplicando as edições das transcrições em `~/.claude/projects/-Users-alexandrerocha-openclaw/` sobre a base de 24/09, no branch `recuperado`.
- Para arquivos com JS compilado em `~/openclaw/apps/api/dist` (83 de 139), portar do compilado é mais confiável que reaplicar patches: foi assim no `google.service.ts` (35 métodos, 414 → 1000 linhas).
- `menu.service.ts`, `assistant.service.ts`, `inbound.service.ts` e `app-chat.service.ts` NÃO estão no dist. O que faltava neles ficou desativado em blocos marcados `DESATIVADO NA RECUPERAÇÃO`, que avisam o usuário em vez de quebrar.
- Deploy na e2-micro: Postgres + API + Caddy por Docker Compose, sem Redis (o Postgres guarda estado, filas e cache). Limites: Postgres 300M, API 400M, Caddy 100M, mais 2 GB de swap.

## Tried and ruled out
- Reaplicar patches automaticamente com tentativa de cwd alternativo: gera arquivos em caminhos errados (billing, agenda-view, notify-prefs, páginas do Next.js na raiz). Conferir `git status` por arquivos soltos na raiz depois de qualquer replay.
- Filtro de segurança por palavra no comando: a palavra "next" dentro de um heredoc fazia descartar a criação de arquivos inteiros. Stripar o corpo do heredoc antes de classificar o comando.
- Rodar `docker compose build` por SSH sem `nohup`: a build morre quando a sessão fecha. Use `(nohup ... > ~/log 2>&1 &)` e verifique o log depois.

## Watch out
- 20 dos 23 nomes "não encontrados" pelo TypeScript eram só linhas de import perdidas, não código faltando. Resolver imports ANTES de concluir que falta funcionalidade.
- Erros de boot do Nest aparecem um por vez e cada rebuild na VM leva mais de 10 min. Valide o grafo localmente: `node dist/main` com `DATABASE_URL` falsa mostra todos os erros de dependência até "Nest application successfully started".
- Faltavam `AutomationRunner` no `AutomationsModule` e `VaultModule` nos imports do `ChannelsModule`.
- `WEBHOOK_SECRET` precisa ser o mesmo do Railway: cifra os tokens do Google e os segredos do cofre.
- `billing` (Mercado Pago) e `vault` estão completos mas não revisados; os métodos portados do compilado perderam tipos (muitos `any`) e comentários.
- Conta de faturamento do Google é em BRL: `gcloud billing budgets create` com `8USD` dá INVALID_ARGUMENT. E o budget cobre a conta toda sem `--filter-projects=projects/<número>`.
