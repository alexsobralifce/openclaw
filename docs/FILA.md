# Fila de tarefas

Quando o dono pedir "adicione na fila", o item entra aqui, com o contexto, as decisões em aberto e o que fecha o item. Ao concluir, vai para "Feito" com a data.

## Próximas

## Pendências já combinadas (dependem do dono ou de uma decisão)
- **Chaves do Spotify e do Google (clima):** criar o app no Spotify e a chave no Google Cloud e colar no Railway; passo a passo em `docs/SPOTIFY_GOOGLE_SETUP.md`. O código já está no ar, desligado.
- **Search Console:** verificar `magobox.com.br`, enviar o sitemap e pedir indexação (passo a passo em `DOMINIO_MAGOBOX.md`).
- **Instagram (Meta):** cadastrar `https://api.magobox.com.br/api/v1/channels/instagram/callback` e depois trocar `INSTAGRAM_REDIRECT_URI`.
- **Telegram:** criar o bot no @BotFather e definir `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` e `TELEGRAM_BOT_USERNAME`.
- **E-mails automáticos na fila:** decidir se ficam fora da fila ou expiram sozinhos em 24 h (hoje acumulam até 50).
- **Menu em árvore dentro do WhatsApp:** comando "ajuda" que responde com a árvore, além da página do painel.

## Feito
- 04/10/2026: **Spotify** (tocar e controlar com Premium, buscar por nome e por assunto, criar playlists, música pelo clima e lugar, cartão em Canais) e **clima e localização pelo Google** com reserva no Open-Meteo. Falta só colocar as chaves.
- 04/10/2026: **catálogo de PDFs com tags** (PDF guardado no Drive em `Assist.IA/Documentos`, ficha no Postgres, tags sugeridas pela IA e editáveis, busca por tag, biblioteca no painel, reclassificação das notas antigas). Ficou de fora, por não ter sido pedido: enviar o PDF direto pela página do painel (hoje entra pelo chat, WhatsApp ou app) e catalogar PDFs recebidos pelo Telegram.
- 04/10/2026: apagar evento da agenda e concluir/apagar nota; página de ajuda em árvore.
- 04/10/2026: aviso curto de e-mail novo (sem despejar a fila); modo carro desativado.
- 03/10/2026: chat do app (áudio, arquivo, botão de baixar), Telegram, login com Google, PWA, domínio próprio, memória de conversa de 24 h, Jev nas buscas.
