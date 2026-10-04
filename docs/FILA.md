# Fila de tarefas

Quando o dono pedir "adicione na fila", o item entra aqui, com o contexto, as decisões em aberto e o que fecha o item. Ao concluir, vai para "Feito" com a data.

## Próximas

### 1. Integração com o Spotify, com localização e tempo pelo Google
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
- 04/10/2026: **catálogo de PDFs com tags** (PDF guardado no Drive em `Assist.IA/Documentos`, ficha no Postgres, tags sugeridas pela IA e editáveis, busca por tag, biblioteca no painel, reclassificação das notas antigas). Ficou de fora, por não ter sido pedido: enviar o PDF direto pela página do painel (hoje entra pelo chat, WhatsApp ou app) e catalogar PDFs recebidos pelo Telegram.
- 04/10/2026: apagar evento da agenda e concluir/apagar nota; página de ajuda em árvore.
- 04/10/2026: aviso curto de e-mail novo (sem despejar a fila); modo carro desativado.
- 03/10/2026: chat do app (áudio, arquivo, botão de baixar), Telegram, login com Google, PWA, domínio próprio, memória de conversa de 24 h, Jev nas buscas.
