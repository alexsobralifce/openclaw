# Fila de tarefas

Quando o dono pedir "adicione na fila", o item entra aqui, com o contexto, as decisões em aberto e o que fecha o item. Ao concluir, vai para "Feito" com a data.

## Próximas

### 1. Integração com o Spotify, com localização e tempo pelo Google
Pedido em 04/10/2026 (feito no meio do catálogo de PDFs): "adicione integração com Spotify, com a localização e tempo através do Google".

**Como é hoje**
- Não há nada do Spotify no sistema (o assistente só acha músicas como **arquivos de áudio no Drive**).
- Localização e tempo (clima): o dono manda a localização (📎) ou diz "minha cidade é Recife"; o clima vem do Open-Meteo (`weather.service.ts`), sem Google.

**Decisões do dono** (04/10/2026)
- O assistente deve **tocar e controlar** o Spotify, **buscar e mostrar**, **criar playlists**, **recomendar pelo clima e pelo lugar** e **buscar música por assunto**.
- **Localização e tempo passam a vir do Google**, no lugar do Open-Meteo (`weather.service.ts`).

**Pré-requisitos que dependem do dono** (a pergunta que ficou sem resposta)
1. **App no Spotify for Developers** (grátis): gera `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET`, e precisa da URL de retorno `https://api.magobox.com.br/api/v1/integrations/spotify/callback`. Sem isso, nada do Spotify roda.
2. **Conta Premium**: o Spotify só deixa controlar a reprodução (tocar, pausar, pular, volume) com Premium. Sem ela, só buscar, mostrar e criar playlists.
3. **Chave do Google** com as APIs de Clima (Weather) e Geocoding ativadas no Google Cloud (`GOOGLE_MAPS_API_KEY`); pode ter custo.

**Pontos técnicos**
- Login do usuário no Spotify por OAuth (fluxo com código), com o token cifrado como o do Google; escopos de leitura/controle do player e de playlists.
- Até onde sei, o Spotify desativou a API de recomendações para apps novos (nov/2024): "recomendar pelo clima" será a IA escolhendo palavras de humor e gênero e então **buscando** no Spotify.
- Tudo desligado até as chaves existirem (como o Telegram), com testes por dublê; só dá para validar de verdade depois das chaves.
- O clima do Google muda a fonte do menu e do tempo no assistente: trocar com teste de regressão, mantendo o Open-Meteo como reserva se a chave faltar.

## Pendências já combinadas (dependem do dono ou de uma decisão)
- **Search Console:** verificar `magobox.com.br`, enviar o sitemap e pedir indexação (passo a passo em `DOMINIO_MAGOBOX.md`).
- **Instagram (Meta):** cadastrar `https://api.magobox.com.br/api/v1/channels/instagram/callback` e depois trocar `INSTAGRAM_REDIRECT_URI`.
- **Telegram:** criar o bot no @BotFather e definir `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` e `TELEGRAM_BOT_USERNAME`.
- **E-mails automáticos na fila:** decidir se ficam fora da fila ou expiram sozinhos em 24 h (hoje acumulam até 50).
- **Menu em árvore dentro do WhatsApp:** comando "ajuda" que responde com a árvore, além da página do painel.

## Feito
- 04/10/2026: **catálogo de PDFs com tags** (PDF guardado no Drive em `Assist.IA/Documentos`, ficha no Postgres, tags sugeridas pela IA e editáveis, busca por tag, biblioteca no painel, reclassificação das notas antigas). Ficou de fora, por não ter sido pedido: enviar o PDF direto pela página do painel (hoje entra pelo chat, WhatsApp ou app) e catalogar PDFs recebidos pelo Telegram.
- 04/10/2026: apagar evento da agenda e concluir/apagar nota; página de ajuda em árvore.
- 04/10/2026: aviso curto de e-mail novo (sem despejar a fila); modo carro desativado.
- 03/10/2026: chat do app (áudio, arquivo, botão de baixar), Telegram, login com Google, PWA, domínio próprio, memória de conversa de 24 h, Jev nas buscas.
