# Instagram

O cliente conecta com **um clique** em Canais › Adicionar canal › Instagram: entra no Instagram, autoriza e volta com o canal criado. Ninguém cola chave. Quem configura o app da Meta (uma única vez) é a plataforma.

## Como funciona

1. `GET /api/v1/channels/instagram/auth-url` devolve o link de login (o `state` é um JWT de 10 min com o workspace).
2. Callback `GET /api/v1/channels/instagram/callback`: troca o código por token de 60 dias, ativa o webhook da conta (`subscribed_apps`) e cria o canal. O token fica cifrado em `Channel.config`.
3. Mensagens chegam em `POST /api/v1/channels/webhooks/instagram` (assinatura `X-Hub-Signature-256` obrigatória), entram na fila `InboundEvent` (`instance = ig:<id da conta>`) e viram conversa no inbox. O contato é identificado pelo IGSID em `Contact.externalId`.
4. Resposta: `POST /api/v1/channels/instagram/:channelId/send`. A Meta só permite responder até **24 h** depois da última mensagem do cliente; depois disso a API devolve erro claro.
5. Um job renova os tokens que vencem em menos de 15 dias (a cada 6 h). Se um token deixa de servir, o canal aparece como "Precisa reconectar".

## Configuração (uma vez, em developers.facebook.com)

1. Criar um app do tipo Business e adicionar o produto **Instagram** › "API setup with Instagram login".
2. Copiar o *Instagram app ID* e o *Instagram app secret* para `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`.
3. Em "Business login settings", cadastrar como **Valid OAuth redirect URI**: `<API_URL>/api/v1/channels/instagram/callback`.
4. Em "Configure webhooks": URL de callback `<API_URL>/api/v1/channels/webhooks/instagram`, verify token igual a `INSTAGRAM_VERIFY_TOKEN`, campo `messages` assinado.
5. Enquanto o app estiver em modo desenvolvimento, só contas com papel no app (admin/dev/tester) conseguem conectar.

## App Review (para atender clientes reais)

Requer Advanced Access a `instagram_business_basic` e `instagram_business_manage_messages`, Business Verification e, no envio, um screencast do fluxo completo (conectar → receber DM → responder), instruções de teste com um login do sistema e as URLs públicas:

- Política de privacidade: `<WEB_URL>/privacidade`
- Exclusão de dados: `<WEB_URL>/exclusao-de-dados`

Defina `NEXT_PUBLIC_CONTACT_EMAIL` no build do painel para aparecer nessas páginas.

## Limitações

- Só texto e recebimento de anexos como referência (a URL de mídia da Meta expira). Sem envio de mídia, sem respostas a comentários.
- Automações `send_message` ainda são só de WhatsApp (no Instagram registram erro na regra).
