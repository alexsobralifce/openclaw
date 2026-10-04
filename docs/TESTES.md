# Testes: estratégia enxuta

Meta: poucos testes, que pegam defeito de verdade. Cada teste novo precisa responder a "que defeito real isso pega?".

## Camadas (a pirâmide)

| Camada | O que é | Onde | Comando |
|---|---|---|---|
| **Unitária** (base) | Lógica pura, sem dublê de serviço: parse, busca, tags, regras, cifra | `apps/api/test/*.spec.ts` que só importam módulos puros | `pnpm test:unit` |
| **Fluxo** (meio) | Uma jornada pelo menu, assistente, controller ou serviço, com dublês do Google e do banco | os demais `*.spec.ts` | `pnpm test:flow` |
| **Fumaça** (topo) | O sistema NO AR, como usuário de fora: saúde, rotas protegidas, CORS, páginas públicas | `scripts/smoke.mjs` | `pnpm smoke` |

- `pnpm test` roda as camadas **de baixo para cima** e para se a base falhar. O arquivo vai para a camada pelo que importa (`apps/api/vitest.config.ts`); não precisa renomear.
- **Bottom-up** (unitário primeiro) localiza o defeito: se a base passa e o fluxo quebra, o problema é a ligação entre as peças. **Top-down** (fluxo e fumaça) prova que a jornada do usuário funciona de ponta a ponta.
- Retrato em 04/10/2026: 300 unitários, 499 de fluxo e 20 checagens de fumaça. A pirâmide está invertida (38% unitários, 62% fluxo): os fluxos custam mais para manter porque quebram a cada mudança de menu.

## Quanto rodar, e quando (o número de testes não é a meta)

Rodar os 826 a cada edição é desperdício de tempo e de atenção. Três ciclos:

| Quando | O que rodar | Comando |
|---|---|---|
| **Enquanto codifica** | só os testes ligados ao que mudou (segundos) | `pnpm test:changed` |
| **Antes de commitar** | a camada unitária inteira (rápida) | `pnpm test:unit` |
| **Antes de subir (deploy)** | tudo, de baixo para cima, o typecheck e **a API subindo** | `pnpm test`, `pnpm typecheck` e `pnpm boot-check` |
| **Depois de subir** | o sistema no ar | `pnpm smoke` |

Como não há CI, a execução completa antes do deploy é o único portão: ela precisa estar 100% verde. Mas ela não precisa rodar a cada passo. Para crescer sem inchar, vale a regra do orçamento abaixo (poucos casos por funcionalidade).

## Regras para não exagerar

1. **Lógica nova vai em função pura** com teste unitário. O fluxo só prova a ligação (no máximo 1 arquivo de fluxo por funcionalidade, com 4 a 8 casos: caminho feliz, cancelar, erro, permissão).
2. **Não repita a mesma regra em duas camadas.** Se a busca por tag já tem teste unitário, o fluxo não confere o ranking de novo.
3. **Teste comportamento, não detalhe interno.** Nada de getters, textos exatos de enfeite, ordem de campos ou código de framework.
4. **Dublê só na borda** (Google, banco, IA, relógio). Nunca dublê da lógica que se quer provar.
5. **Todo defeito de produção vira um teste** (e, se só aparece no ar, uma checagem em `smoke.mjs`). Exemplos: o `app.use(json())` que zerava todo POST (`body-parsers.spec.ts` e a checagem "API lê JSON"); o `:` apagado por `normalize` que misturava editar e buscar tag.
6. **Segurança e dados do usuário sempre têm teste:** isolamento por workspace, rota protegida, apagar com confirmação, o que nunca vai ao Jev, segredo fora da memória.
7. **Teste novo que não falharia se o código quebrasse não serve.** Quebre o código de propósito uma vez e veja o teste falhar.

## Podar sem achismo

`pnpm test:audit` roda cada arquivo sozinho com cobertura e mostra quantas linhas **só ele** cobre. Arquivo sem linhas exclusivas é **candidato**, não sentença:

- cobrir uma linha não é verificar o resultado: confira o que o teste afirma;
- unitário puro com 0 linhas exclusivas costuma só estar coberto também pelos fluxos: **fica** (é rápido e aponta o defeito exato);
- só apague com quarentena (mova para uma pasta de lado por um ciclo) e com a decisão registrada aqui.

Auditoria de 04/10/2026: 10 candidatos, todos unitários puros ou testes do painel que a medição da API não enxerga (`wa-markup`, `chat-file`, `web-origins`...). Nada foi apagado por ela. Foram podados à mão 4 asserts triviais (contagem de itens, texto de título, ícone por tipo).

## Skills de teste instaladas (locais, em `.claude/skills/`)

De [qa-skills](https://github.com/petrkindlmann/qa-skills) (MIT), só três, com a descrição encurtada para gastar poucos tokens: `risk-based-testing` (o que pode quebrar e onde focar; rode antes), `test-strategy` (níveis e pirâmide) e `test-suite-curation` (podar com evidência e quarentena). O corpo de cada uma só entra no contexto quando é usada.

## Antes de subir

`pnpm typecheck`, `pnpm test`, `pnpm boot-check` e, depois do deploy, `pnpm smoke`.

Por que o `boot-check`: os testes montam as classes à mão, então não veem um erro de injeção do Nest. Em 04/10/2026 um `import type` num parâmetro de construtor teria derrubado a API em produção; só o boot real pegou.
