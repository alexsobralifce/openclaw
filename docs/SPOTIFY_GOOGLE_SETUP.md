# Ligar o Spotify e o clima do Google

O código está pronto e **desligado** até estas chaves existirem no Railway (serviço `api`). Nada quebra sem elas: o Spotify some do menu e o clima segue no Open-Meteo.

## 1. Spotify (grátis; controlar a reprodução exige conta Premium)

1. Abra https://developer.spotify.com/dashboard, entre com a sua conta e clique em **Create app**.
2. Nome: `MagoBox`. Descrição: qualquer uma. Em **Redirect URIs**, coloque exatamente:
   `https://api.magobox.com.br/api/v1/integrations/spotify/callback`
   Em "Which API/SDKs are you planning to use?", marque **Web API**. Salve.
3. Abra o app, **Settings**, e copie o **Client ID** e o **Client secret** ("View client secret").
4. No Railway, serviço `api`, crie as variáveis `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` (a API reinicia sozinha). Pelo terminal: `railway variables --service api --set "SPOTIFY_CLIENT_ID=..." --set "SPOTIFY_CLIENT_SECRET=..."`.
5. No painel do MagoBox: **Canais › Conectar Spotify** e autorize. (O cartão só aparece para quem tem o serviço **Spotify** liberado; ROOT e ADMIN já têm.)
6. Abra o Spotify no celular ou no computador e diga ao assistente: *tocar catingueira*.

Observações
- O app do Spotify em **modo de desenvolvimento** só aceita os usuários que você cadastrar no painel dele (Settings › User Management) e limita o número deles; para você sozinho basta. Confira as regras atuais no painel do Spotify.
- Sem Premium o assistente só busca músicas e cria playlists: o Spotify não deixa controlar o player.
- Playlists criadas ficam **privadas** na sua conta; o assistente não apaga nem edita as que já existem.

## 2. Clima e localização pelo Google

1. No Google Cloud (o mesmo projeto do login com Google), **APIs e serviços › Biblioteca**: ative **Weather API** e **Geocoding API**. É preciso ter o faturamento ativo no projeto; veja os preços e a cota gratuita antes (o sistema guarda cada previsão por 10 minutos para gastar pouco).
2. **Credenciais › Criar credenciais › Chave de API**. Em **Restrições de API**, limite a chave às duas APIs acima.
3. No Railway, serviço `api`: variável `GOOGLE_MAPS_API_KEY` com a chave.
4. Teste: diga *clima* ao assistente. A última linha mostra `Fonte: Google`.

Se a chave faltar, ou o Google falhar ou não cobrir o lugar, o assistente usa o Open-Meteo sozinho (e o log avisa).
