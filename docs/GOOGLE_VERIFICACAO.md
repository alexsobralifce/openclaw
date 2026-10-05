# Verificação do app no Google (Central de verificação)

Textos para colar em **Google Auth Platform > Central de verificação > Acesso a dados** (justificativa de cada escopo, uso pretendido dos dados e vídeo de demonstração). O formulário do Google costuma ser lido em inglês, por isso os textos abaixo estão em inglês. Confira cada afirmação com o comportamento real do app antes de enviar (fonte: `apps/api/src/modules/integrations/google/google.service.ts`, escopos em `SCOPES`).

Escopos pedidos: `gmail.modify` (restrito), `calendar.events` (sensível), `calendar.calendarlist.readonly` (sensível), `drive.readonly` (restrito), `drive.file` (não sensível), `contacts.readonly` (sensível), mais `openid` e `email`.

## Uso pretendido dos dados (campo "how will the app use the data")

> MagoBox is a personal assistant that the user talks to through WhatsApp or a web/mobile chat. After the user connects their own Google account, the assistant can read and organize their email, show and create calendar events, find and send back files from their Drive, save notes and documents (PDFs) in a folder it creates in their Drive, and look up their contacts. Every action is requested by the user in chat. Sending emails, deleting emails and creating events only happen after the user explicitly confirms. Google data is used only to provide these user-facing features. It is not sold, not used for advertising, not used to train AI models, and not shared with third parties except as needed to run the feature the user asked for (the text of a message or file is processed by our AI provider to answer that specific request). Access tokens are stored encrypted and are deleted when the user disconnects Google.

## Justificativa por escopo

**https://www.googleapis.com/auth/gmail.modify** (restrito)

> The user asks the assistant, in chat, to read and search their emails, to be notified of new emails, and to act on them: mark as read, archive, move to spam, move to trash, and send or reply (for replies the assistant drafts the text and sends only after the user confirms). These actions require modifying labels (mark read, archive, spam), trashing messages and sending, which the read-only scope cannot do. We do not use gmail.send alone because we also need to read messages and change labels, and we do not request full-account access (https://mail.google.com/). Email content is used only to answer the user's request and is not stored beyond a short-lived queue (up to 48 hours) used to notify the user of new messages.

**https://www.googleapis.com/auth/calendar.events** (sensível)

> The user asks the assistant to show today's, tomorrow's or this week's events and to create events from a sentence, a photo or a PDF (for example "add the dentist on Friday at 3 pm"). Creating events requires write access to calendar events (we use calendar.events, not the broader calendar scope, because the app only reads, creates and deletes events in the user's primary calendar and never manages calendars or sharing). Events are only created after the user confirms them in chat, and the assistant can also delete an event only when the user explicitly asks and confirms.

**https://www.googleapis.com/auth/calendar.calendarlist.readonly** (sensível)

> Users keep several calendars in their Google account (for example a class calendar or a shared one). When the user asks the assistant "what is on my agenda this week", we need to know which calendars the user has enabled, so that events from all of them are shown, not only the primary one. This scope is used only to list the names and ids of the calendars (read-only); event data is read and written through the calendar.events scope. We never create, edit, delete or share calendars.

**https://www.googleapis.com/auth/drive.readonly** (restrito)

> The user asks the assistant to find and send back a file that already exists in their Drive (for example "send me the lease contract PDF"). Searching and downloading arbitrary existing files requires read access to the Drive. The narrower drive.file scope only covers files the app created, so it cannot find the user's own files. The app never modifies or deletes these files. File contents are sent to the user in the chat they asked from and are not kept.

**https://www.googleapis.com/auth/drive.file** (não sensível)

> The assistant saves the user's notes, imported contacts and catalogued documents (PDFs the user sends in chat) as files in a folder the app creates in the user's own Drive. This scope lets the app create and edit only the files it created itself, and it is used for no other file. The app never deletes files in the user's Drive; when the user deletes a document in the app, the file is moved to the Drive trash (recoverable for 30 days).

**https://www.googleapis.com/auth/contacts.readonly** (sensível)

> When the user connects Google, the app reads their contacts once (read-only) and saves them as text files in the app's folder in their Drive, so the user can ask the assistant things like "what is Maria's phone number?" or "email João". The app never creates, edits or deletes Google contacts.

**openid, email** (não sensíveis)

> Used to identify which Google account was connected and to show it to the user.

## Roteiro do vídeo de demonstração (YouTube, "não listado")

Grave a tela (celular e computador servem), com narração ou legendas em inglês. Duração sugerida: 4 a 6 minutos. Mostre o endereço do app na barra do navegador e use uma conta de teste.

1. **Abertura (15 s):** mostre `https://www.magobox.com.br`, a política de privacidade e o link no rodapé. Diga o que o app faz.
2. **Login e autorização (45 s):** em *Canais*, clique em *Conectar Google*. Mostre a **tela de permissão do Google completa**, com o nome do app e cada permissão, e o ID do cliente OAuth visível na URL (`client_id=`). Clique em *Permitir*.
3. **Gmail (60 s):** peça "ler e-mails". Mostre a lista, abra um e-mail, marque como lido, arquive e apague um. Peça para responder: mostre o rascunho, a confirmação e o envio.
4. **Agenda (45 s):** peça "agenda de hoje". Crie um evento com uma frase e confirme. Mostre o evento no Google Agenda.
5. **Drive (45 s):** peça um arquivo existente ("manda o PDF do contrato") e mostre o arquivo chegando no chat. Mostre também que o app não altera esse arquivo.
6. **Notas, documentos e contatos (45 s):** crie uma nota, mande um PDF (catalogado com tags e categoria) e mostre os arquivos criados na pasta *Assist.IA* do Drive. Peça um telefone de um contato.
7. **Desconectar (20 s):** em *Canais*, desconecte o Google e mostre que o acesso foi removido (também em myaccount.google.com/permissions).

Dicas: não mostre dados reais de terceiros, deixe a tela de permissão parada por alguns segundos e use o mesmo domínio e nome de app cadastrados em *Branding*.

## Antes de enviar

- Domínio verificado no Search Console (feito: arquivo `googledca835bfffe82f52.html`).
- Marca verificada e app em produção (feito).
- Política de privacidade com a declaração de Uso Limitado (já está em `/privacidade`) e rodapé da landing com os links (feito).
- Endereço do app e da política em `https://www.magobox.com.br` (o domínio sem `www` ainda não resolve no DNS).
- E-mail de contato do projeto que você monitora: o Google responde por ele.
- Gmail e Drive (`drive.readonly`) são escopos restritos: o Google pode exigir a avaliação de segurança anual (CASA). Confirme prazo e custo no formulário.

## Gravar o vídeo sem falar inglês (cartões de legenda)

Use `docs/video-verificacao-google.html`: ele mostra um cartão em inglês por cena. Não precisa de narração: o vídeo é só a tela, com os cartões entre as cenas.

**Preparação**
1. Abra duas abas no navegador: a **aba 1** com `docs/video-verificacao-google.html` (abra o arquivo direto, em tela cheia com F11) e a **aba 2** com `https://app.magobox.com.br`, logada com uma **conta Google de teste**.
2. Deixe o Gmail da conta de teste com 3 ou 4 e-mails fictícios e uma agenda vazia. Nada de dados de terceiros.
3. Comece a gravar a tela (Mac: `Cmd + Shift + 5`).

**Roteiro (para cada cena: mostre o cartão por ~5 s, com a seta direita, e troque para o app)**

| Cena | Cartão | O que fazer no app | Frases para digitar |
|---|---|---|---|
| 0 | Abertura | Mostre a landing `www.magobox.com.br` e o rodapé com a política de privacidade. | |
| 1 | Step 1 | Em *Canais*, clique em **Conectar Google**. **Pare 5 segundos na tela de permissão do Google**, com a URL e o `client_id` visíveis. Clique em Permitir. | |
| 2 | Step 2 · Gmail | No chat: ler e-mails, abrir um, marcar como lido, arquivar um, apagar um, responder com a confirmação. | `ler e-mails`, depois os números do menu |
| 3 | Step 3 · Calendar | Crie um evento, confirme e mostre-o no Google Agenda (outra aba). | `adicionar na agenda: dentista sexta às 15h`, depois `1` para confirmar |
| 4 | Step 4 · Drive (leitura) | Peça um arquivo que já está no Drive e mostre-o chegando no chat. | `drive`, depois o nome do arquivo |
| 5 | Step 5 · Drive (arquivos do app) | Crie uma nota, envie um PDF e mostre a pasta *Assist.IA* no Drive com os arquivos criados. | `nota sobre Teste: reunião às 10h`; anexe um PDF |
| 6 | Step 6 · Contatos | Peça o telefone de um contato. | `contatos`, depois o nome |
| 7 | Step 7 | Em *Canais*, clique em **Desconectar Google** e mostre em `myaccount.google.com/permissions` que o app saiu da lista. | |

**Depois**
1. Pare a gravação, corte o que sobrar no começo e no fim (o próprio QuickTime ou o iMovie servem).
2. Suba no YouTube como **Não listado** e cole o link na Central de verificação.

Se o roteiro de algum passo não funcionar com a frase indicada, use o menu numerado do assistente (digite `menu` e toque nas opções): o importante é o Google ver cada permissão sendo usada.

## Legendas e narração em inglês com o Gemini (a partir da gravação real)

O vídeo precisa ser a gravação real do app. O Gemini só ajuda com o inglês: ele gera as legendas (SRT) e o texto da narração a partir do vídeo gravado. Não use IA para gerar imagens do app nem da tela de permissão do Google.

Anexe o vídeo gravado ao Gemini (app ou aistudio.google.com) e cole:

```
Você é editor de legendas. Em anexo está uma gravação de tela REAL do app MagoBox (assistente pessoal por WhatsApp e chat web), feita para o vídeo de demonstração da verificação OAuth do Google. NÃO altere, não gere nem invente imagens: só trabalhe sobre o vídeo anexado.

Tarefa:
1. Assista ao vídeo e identifique as cenas, na ordem:
   - Abertura: página inicial www.magobox.com.br e rodapé com a política de privacidade.
   - Conexão: o usuário conecta a conta Google; tela de consentimento do Google.
   - Gmail (gmail.modify): ler e-mails, marcar como lido, arquivar, apagar, responder com confirmação antes de enviar.
   - Agenda (calendar.events): criar um evento por uma frase, com confirmação.
   - Drive (drive.readonly): pedir um arquivo que já existe; o app só lê.
   - Drive (drive.file): salvar nota e PDF na pasta própria do app (Assist.IA).
   - Contatos (contacts.readonly): consultar o telefone de um contato; só leitura.
   - Desconexão: remover o acesso do Google.
2. Gere um arquivo de legendas em inglês no formato SRT, com tempos (HH:MM:SS,mmm) alinhados ao que aparece na tela, descrevendo em frases curtas o que o usuário faz e qual permissão está sendo usada. Frases de até 2 linhas, no máximo 42 caracteres por linha.
3. Gere também o texto de uma narração em inglês, uma frase por cena, com o tempo de início de cada cena.
4. Não descreva nada que não apareça no vídeo. Se uma cena estiver faltando ou pouco clara, diga qual e não preencha com suposições.

Entregue: (a) o SRT completo em um bloco de código; (b) a narração por cena; (c) uma lista de cenas que faltaram ou que precisam ser regravadas.

Contexto fixo (use estas informações, sem acrescentar outras):
- App: MagoBox, https://www.magobox.com.br
- Escopos: gmail.modify, calendar.events, drive.readonly, drive.file, contacts.readonly, openid, email.
- Envio de e-mail, exclusão de e-mail e criação de evento só acontecem depois da confirmação do usuário.
- O app nunca altera nem apaga arquivos existentes do Drive.
```

Depois: salve o SRT como `legendas.srt` e, no YouTube Studio, abra o vídeo, vá em **Legendas > Adicionar > Enviar arquivo**. Confira os tempos e o texto antes de enviar: a IA pode errar o tempo ou descrever o que não está na tela.
