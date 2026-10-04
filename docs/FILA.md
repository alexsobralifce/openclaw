# Fila de tarefas

Quando o dono pedir "adicione na fila", o item entra aqui, com o contexto, as decisões em aberto e o que fecha o item. Ao concluir, vai para "Feito" com a data.

## Próximas

### 1. Catálogo de PDFs e documentos, com tags para buscar por assunto
Pedido em 04/10/2026: a inserção de PDFs, assim como a documentação deles, precisa ser organizada e catalogada, com tags que identifiquem o assunto a buscar.

**Como é hoje**
- PDF ou foto enviado ao assistente é lido pelo Gemini, resumido e vira uma **nota** em `Assist.IA/Notas/<assunto>/` no Drive (`noteIngest`, `renderNote`).
- O **arquivo original não é guardado**: só o resumo.
- A nota tem no topo `assunto`, `criada`, `origem` e `tags: [<assunto>]`: ou seja, a única "tag" é o nome do assunto.
- A busca (`noteSearch`) procura trechos de texto nas notas; não há busca por tag nem listagem de catálogo.

**Decisões em aberto** (perguntadas ao dono em 04/10/2026)
1. Guardar o PDF original no Drive (com uma ficha de catálogo) ou só o resumo, como hoje?
2. Tags: geradas pela IA (3 a 6 por documento) e editáveis pelo dono?
3. Onde ver o catálogo: só no assistente, ou também uma página de biblioteca no painel, com filtro por tag?
4. O que fazer com as notas que já vieram de PDF: reclassificar com tags?

**Fecha o item quando**
- todo PDF novo entra com título, assunto, tags e data, num lugar previsível;
- dá para pedir "documentos com a tag X" / "o PDF sobre Y" e receber a lista (e o arquivo, se foi guardado);
- dá para ver, acrescentar e tirar tags de um documento;
- a página de ajuda (`lib/menu-docs.ts`) explica o fluxo, e há testes.

## Pendências já combinadas (dependem do dono ou de uma decisão)
- **Search Console:** verificar `magobox.com.br`, enviar o sitemap e pedir indexação (passo a passo em `DOMINIO_MAGOBOX.md`).
- **Instagram (Meta):** cadastrar `https://api.magobox.com.br/api/v1/channels/instagram/callback` e depois trocar `INSTAGRAM_REDIRECT_URI`.
- **Telegram:** criar o bot no @BotFather e definir `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` e `TELEGRAM_BOT_USERNAME`.
- **E-mails automáticos na fila:** decidir se ficam fora da fila ou expiram sozinhos em 24 h (hoje acumulam até 50).
- **Menu em árvore dentro do WhatsApp:** comando "ajuda" que responde com a árvore, além da página do painel.

## Feito
- 04/10/2026: apagar evento da agenda e concluir/apagar nota; página de ajuda em árvore.
- 04/10/2026: aviso curto de e-mail novo (sem despejar a fila); modo carro desativado.
- 03/10/2026: chat do app (áudio, arquivo, botão de baixar), Telegram, login com Google, PWA, domínio próprio, memória de conversa de 24 h, Jev nas buscas.
