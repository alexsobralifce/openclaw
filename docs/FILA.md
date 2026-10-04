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

**Decisões do dono** (04/10/2026)
1. **Guardar o PDF original** no Drive (`Assist.IA/Documentos`), com uma **ficha de catálogo**: título, assunto, tags, data e resumo.
2. **Tags: a IA sugere (3 a 6 por documento) e o dono edita** (acrescenta e tira, por exemplo "tags do documento 2: contrato, aluguel").
3. **Catálogo no assistente e numa página de biblioteca no painel**, com filtro por tag e botão de baixar.
4. **Reclassificar os PDFs que já viraram nota**: um comando passa pelas notas que vieram de PDF e acrescenta as tags, sem apagar nada.

**Pontos técnicos a decidir ao começar** (não bloqueiam o pedido)
- Onde guardar o catálogo para buscar por tag: propriedades do próprio arquivo no Drive (`appProperties`) ou uma tabela no Postgres (busca e filtro mais simples; precisa de índice comum, nunca `@unique`). A recomendação é Postgres para o índice e o Drive para o arquivo.
- Limite de tamanho e de páginas do PDF (hoje 15 MB e o teto do plano, em `media-limits.ts`) e o que fazer com PDF escaneado, sem texto.
- Com o escopo `drive.file`, o app só mexe em arquivos que ele mesmo criou: o PDF guardado por ele pode ser listado e apagado; PDFs que o dono já tinha no Drive entram no catálogo só por cópia ou por link.
- Reclassificação: rodar em lotes pequenos e mostrar o progresso, porque cada nota custa uma chamada de IA.

**Fecha o item quando**
- todo PDF novo entra com título, assunto, tags e data, num lugar previsível;
- dá para pedir "documentos com a tag X" / "o PDF sobre Y" e receber a lista (e o arquivo, se foi guardado);
- dá para ver, acrescentar e tirar tags de um documento;
- a página de ajuda (`lib/menu-docs.ts`) explica o fluxo, e há testes.

### 2. Integração com o Spotify, com localização e tempo pelo Google
Pedido em 04/10/2026 (feito no meio do catálogo de PDFs): "adicione integração com Spotify, com a localização e tempo através do Google".

**Como é hoje**
- Não há nada do Spotify no sistema (o assistente só acha músicas como **arquivos de áudio no Drive**).
- Localização e tempo (clima): o dono manda a localização (📎) ou diz "minha cidade é Recife"; o clima vem do Open-Meteo (`weather.service.ts`), sem Google.

**Perguntas em aberto**
1. O que o assistente deve fazer no Spotify? (tocar/pausar num aparelho, buscar e tocar música ou artista, mostrar o que está tocando, criar/abrir playlists, recomendar.) Controlar a reprodução exige conta **Premium** e um app registrado no Spotify for Developers (client id e secret), com login do usuário (OAuth).
2. "Localização e tempo através do Google" é para trocar o Open-Meteo por APIs do Google (Weather, Geocoding, Time Zone), ou para outra coisa, como sugerir música pelo clima e pelo lugar? As APIs do Google precisam ser ativadas no projeto do Google Cloud (pode ter custo).
3. Como a localização do usuário deve ser obtida: pela localização que ele já manda, ou pelo navegador/celular?

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
