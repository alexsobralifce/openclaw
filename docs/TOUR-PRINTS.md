# Prints do tour de boas-vindas

O tour (`apps/web/src/components/onboarding/WelcomeTour.tsx`) mostra prints reais das telas, em `apps/web/public/onboarding/<passo>-desktop|mobile.webp`.
Eles são gerados com contas de **demonstração no banco local** (nunca produção). Refaça sempre que uma dessas telas mudar:
Resumo, menu, chat, Canais, Documentos, Cofre e Assinatura.

## Como gerar

1. Postgres local: `docker compose -f docker-compose.dev.yml up -d postgres` (porta 5433).
2. Schema local: `DATABASE_URL=postgresql://openclaw:openclaw@localhost:5433/openclaw pnpm --filter @openclaw/database db:push`.
3. API em outra porta (3011), sem mexer no `dist/` do dia a dia:
   ```
   cd apps/api && ./node_modules/.bin/tsc -p tsconfig.json --outDir .dist-prints
   DATABASE_URL=postgresql://openclaw:openclaw@localhost:5433/openclaw PORT=3011 WEB_URL=http://localhost:3010 \
     MERCADOPAGO_ACCESS_TOKEN=TEST-demo MERCADOPAGO_PUBLIC_KEY=TEST-demo node .dist-prints/main.js
   ```
4. Web em outra porta (3010), com pasta de build própria:
   `cd apps/web && NEXT_DIST_DIR=.next-prints NEXT_PUBLIC_API_URL=http://localhost:3011 ./node_modules/.bin/next dev -p 3010`
5. `pnpm prints:onboarding` (Playwright; se faltar o navegador: `npx playwright install chromium`).
6. Abra as imagens geradas e confira: só dados fictícios (contas `ana@magobox.local` e `novo@magobox.local`) e o contorno roxo no lugar certo.

Para mudar os passos ou textos do tour, edite `STEPS` em `WelcomeTour.tsx`; cada `id` precisa ter o par de imagens com o mesmo nome.
