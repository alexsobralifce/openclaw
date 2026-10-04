# Verificação do app no Google (Central de verificação)

Textos para colar em **Google Auth Platform > Central de verificação > Acesso a dados** (justificativa de cada escopo, uso pretendido dos dados e vídeo de demonstração). O formulário do Google costuma ser lido em inglês, por isso os textos abaixo estão em inglês. Confira cada afirmação com o comportamento real do app antes de enviar (fonte: `apps/api/src/modules/integrations/google/google.service.ts`, escopos em `SCOPES`).

Escopos pedidos: `gmail.modify` (restrito), `calendar` (sensível), `drive.readonly` (restrito), `drive.file` (não sensível), `contacts.readonly` (sensível), mais `openid` e `email`.

## Uso pretendido dos dados (campo "how will the app use the data")

> MagoBox is a personal assistant that the user talks to through WhatsApp or a web/mobile chat. After the user connects their own Google account, the assistant can read and organize their email, show and create calendar events, find and send back files from their Drive, save notes and documents (PDFs) in a folder it creates in their Drive, and look up their contacts. Every action is requested by the user in chat. Sending emails, deleting emails and creating events only happen after the user explicitly confirms. Google data is used only to provide these user-facing features. It is not sold, not used for advertising, not used to train AI models, and not shared with third parties except as needed to run the feature the user asked for (the text of a message or file is processed by our AI provider to answer that specific request). Access tokens are stored encrypted and are deleted when the user disconnects Google.

## Justificativa por escopo

**https://www.googleapis.com/auth/gmail.modify** (restrito)

> The user asks the assistant, in chat, to read and search their emails, to be notified of new emails, and to act on them: mark as read, archive, move to spam, move to trash, and send or reply (for replies the assistant drafts the text and sends only after the user confirms). These actions require modifying labels (mark read, archive, spam), trashing messages and sending, which the read-only scope cannot do. We do not use gmail.send alone because we also need to read messages and change labels, and we do not request full-account access (https://mail.google.com/). Email content is used only to answer the user's request and is not stored beyond a short-lived queue (up to 48 hours) used to notify the user of new messages.

**https://www.googleapis.com/auth/calendar** (sensível)

> The user asks the assistant to show today's, tomorrow's or this week's events and to create events from a sentence, a photo or a PDF (for example "add the dentist on Friday at 3 pm"). Creating events requires write access to the calendar. Events are only created after the user confirms them in chat, and the assistant can also delete an event only when the user explicitly asks and confirms.

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
