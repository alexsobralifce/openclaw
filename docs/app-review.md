# App Review da Meta (Instagram)

Objetivo: liberar `instagram_business_basic` e `instagram_business_manage_messages` com **Advanced Access**, para clientes conectarem a própria conta sem ter papel no app. App: **openclaw** (ID `1907082150258730`).

## Caminho exigido pela Meta

Ao escolher *Permissões e recursos → Ações → Adicionar à análise do app*, a Meta exige que o app vire **Tech Provider** (decisão **irreversível**), em três etapas:

1. **Verificação da empresa** (Business Verification): comprova a empresa com documentos. Hoje o app **não está ligado a nenhum portfólio**; é preciso conectar um (Configurações do app → Básico, ou Painel) e verificá-lo. Portfólios da conta: EndorfinApp, Ilumisol-Sobral, North Drone Sobral, Orbit Pro. Escolha o da empresa que presta o serviço, pois a verificação fica presa a ele.
2. **Verificação de acesso**: só libera depois da verificação da empresa; a Meta analisa em cerca de 5 dias.
3. **Análise do app**: perguntas de uso/tratamento de dados, vídeo e instruções de teste (abaixo).

## Pré-requisitos (checklist)

- [x] App publicado (modo ao vivo)
- [x] Política de Privacidade: `https://web-production-0bb3d.up.railway.app/privacidade`
- [x] Exclusão de dados: `https://web-production-0bb3d.up.railway.app/exclusao-de-dados`
- [x] Termos de Serviço: `https://web-production-0bb3d.up.railway.app/termos`
- [x] Login OAuth e webhook configurados e funcionando
- [ ] Ícone do app (1024×1024): arquivo em `apps/web/public/brand/assistia-icon-1024.png`, soltar em Configurações do app → Básico
- [ ] Portfólio empresarial conectado e verificado
- [ ] Login de teste no sistema para o revisor (sem 2FA), com o serviço `inbox` e `channels` liberados
- [ ] Conta de Instagram **profissional** de teste, com papel de Testador no app, e uma segunda conta para mandar a DM
- [ ] Vídeo (screencast) gravado conforme o roteiro
- [ ] Página `https://web-production-0bb3d.up.railway.app` acessível durante toda a análise (se a Meta não conseguir testar, **a submissão inteira é rejeitada**)

## Roteiro do vídeo (2 a 4 minutos, interface legível; legendas em inglês)

1. Abrir o painel, entrar com o login de teste e ir em **Canais**.
2. Clicar em **Adicionar canal → Instagram**. Mostrar a tela de login do Instagram e a **tela de consentimento** listando as permissões (esse trecho é o que mais reprova se faltar).
3. Autorizar. Voltar ao painel com o canal *Instagram (@conta)* conectado.
4. Com a **segunda conta**, enviar uma DM para a conta conectada (mostrar o aparelho/tela do Instagram).
5. Mostrar a mensagem aparecendo na **Caixa de entrada** do openclaw.
6. Responder pelo painel e mostrar a resposta chegando no Instagram da segunda conta.
7. (Opcional) Mostrar **Remover** o canal e citar a página de exclusão de dados.

## Textos de justificativa (colar em inglês)

**instagram_business_basic**
> Our app is a customer-support inbox for businesses. After a business connects its Instagram professional account through Instagram Business Login, we use `instagram_business_basic` to read the account's ID and username, so we can identify which connected account each incoming conversation belongs to and display its name in the channel list. We do not read or store media or posts.

**instagram_business_manage_messages**
> Businesses use our app to receive and answer Instagram Direct messages from their customers in a shared inbox. We use `instagram_business_manage_messages` to (1) receive incoming messages through the webhook and show them to the business's support team, and (2) send replies written by that team, only within the 24-hour messaging window after the customer's last message. Messages are shown only to the members of the connected business's workspace. We do not use messages for advertising or share them with third parties.

## Instruções de teste (colar no campo do revisor)

```
1. Open https://web-production-0bb3d.up.railway.app/auth/login and sign in with the test user provided in the credentials field.
2. Go to "Canais" (Channels) > "Adicionar canal" (Add channel) > "Instagram".
3. Log in with the test Instagram professional account provided and approve the permissions.
4. From a second Instagram account, send a direct message to the connected account.
5. The message appears in the "Caixa de entrada" (Inbox). Open it and send a reply. The reply is delivered to the second account.
```

## Depois de aprovado

- Trocar o app para uso de clientes: nada muda no código (o mesmo `INSTAGRAM_APP_ID`).
- Se quiser responder após 24 h (até 7 dias), o recurso **Human Agent** (Permissões e recursos) precisa ser adicionado à análise e o envio deve usar a tag `human_agent`, o que ainda não está implementado.
- Rotacionar o *app secret* (`INSTAGRAM_APP_SECRET` no Railway) antes de ter clientes reais.
