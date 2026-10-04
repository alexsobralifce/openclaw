# Assistente no carro com MacroDroid

Guia para falar com o Assist.IA no carro **sem passar pelo Gemini nem pelo WhatsApp**. O MacroDroid manda um comando à API, recebe a resposta já no formato falado e lê em voz alta. Não há a pergunta "quer enviar?", porque nenhuma mensagem é enviada.

> **Status:** o endpoint `POST /api/public/v1/assistant/command` está no código, mas só funciona depois do deploy (`railway up --service api --detach`).
> **Não verificado:** os nomes exatos de gatilhos e ações do MacroDroid abaixo seguem o app em inglês e podem variar por versão. Confira na sua.

## 1. Como funciona

```
Botão (volante/fone/widget) → MacroDroid → POST /assistant/command → menu do assistente
                                                                          ↓
                          voz do celular ← Speak Text ← JSON { "fala": "..." } ←
```

- O endpoint roda o **mesmo menu do WhatsApp**: e-mails, agenda, Drive e clima.
- Cada chamada liga o **modo carro** (texto limpo, sem emoji nem markdown, até 350 caracteres). O modo desliga sozinho após `CAR_MODE_HOURS` (padrão 3 h) sem uso.
- O menu guarda a tela atual: depois de "ler e-mails", um "próximo" ou "sim" continua de onde parou.

## 2. O que não roda por essa rota

| Não roda | Por quê |
|---|---|
| Pedido livre à IA ("mande um oi para o cliente") | A IA pode agir, como enviar mensagens, e a chave fica num celular. Se o menu não entende, a resposta é "Não entendi. Diga, por exemplo, agenda de hoje ou ler e-mails." |
| Cofre de senhas | O modo carro já recusa ler senhas em voz alta. |
| Comando ditado livremente | As macros mandam **comandos fixos por botão**. Falar qualquer frase exigiria transcrição de voz no celular. |

## 3. Preparação (uma vez)

1. **Deploy da API** no Railway (seção de status acima).
2. **Criar a chave de API** no painel, com **apenas** o escopo `assistant:command`.
   - Copie a chave (`oc_live_...`); ela só aparece uma vez.
   - Use uma chave exclusiva para o carro. Ela permite confirmar ações do menu (apagar e-mail, enviar rascunho). Se perder o celular, revogue-a no painel.
3. **No celular**, dê ao MacroDroid acesso a notificações e desative a otimização de bateria para ele, senão as macros podem não disparar.
4. Anote a URL da sua API, por exemplo `https://SUA-API/api/public/v1/assistant/command`.

## 4. Testar antes de montar as macros

No computador, troque os dois valores e rode:

```bash
curl -X POST https://SUA-API/api/public/v1/assistant/command \
  -H "Authorization: Bearer oc_live_SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"text":"agenda de hoje"}'
```

Resposta esperada: `{"fala":"..."}`. Erros comuns:

| Resposta | Causa |
|---|---|
| 401 | Chave ausente, errada ou revogada |
| 403 | Chave sem o escopo `assistant:command`, ou conta sem o serviço "assistente" |
| 429 | Limite de requisições excedido (veja `Retry-After`) |
| `fala` = "Não entendi..." | O menu não reconheceu o texto; teste `ler e-mails` ou `agenda` |

## 5. Montar a macro (só 2 ações)

Cada macro tem **uma ação de requisição e uma de fala**. Não precisa de JSON Parse nem de variável de dicionário.

**Ação 1: HTTP Request**

| Campo | Valor |
|---|---|
| Método | `POST` |
| URL | `https://api-production-f2743.up.railway.app/api/public/v1/assistant/command?formato=texto` |
| Cabeçalho 1 | `Authorization` = `Bearer SUA_CHAVE` |
| Cabeçalho 2 | `Content-Type` = `application/json` |
| Corpo | `{"text":"ler e-mails; Pessoal"}` |
| Bloquear a próxima ação até terminar | **ligado** |
| Salvar a resposta em | uma variável de texto, ex.: `resposta` |

**Ação 2: Speak Text**: texto = `{lv=resposta}`. Use o seletor de magic text (botão `[...]` ao lado do campo → Variável local → `resposta`) em vez de digitar. Sem as chaves, o MacroDroid fala o texto literal "lv=resposta".

Use **aspas retas** (`"`) no corpo. O `?formato=texto` no fim da URL faz o assistente devolver só a frase falada.

### Vários comandos de uma vez

Separe com `;` (até 4). O assistente roda em ordem e fala só a última resposta. Assim a macro não erra a tela:

| Macro | Corpo (`text`) |
|---|---|
| E-mails Pessoal | `ler e-mails; Pessoal` |
| E-mails IFCE | `ler e-mails; IFCE` |
| Agenda de hoje | `agenda de hoje` |
| Próximo | `próximo` |
| Sim (confirmar) | `sim` |

Dica: monte **uma** macro completa, teste, e duplique-a trocando só o corpo.

Outros comandos que o menu entende (os mesmos do WhatsApp): `clima`, `agenda amanhã`, `sair do modo carro` etc. Teste no `curl` antes.

### Anotar por voz (notas no Drive)

Com o serviço **Drive** liberado e o Google reconectado (escopo de gravação), dá para ditar anotações e consultá-las:

| Macro | Corpo (`text`) |
|---|---|
| Anotar | `anota no obsidian: {lv=ditado}` (use o texto ditado pelo *Voice Input*) |
| O que anotei | `o que anotei sobre {lv=assunto}` |

- A anotação vai para `Assist.IA/AAAA-MM-DD.md` no seu Drive (uma linha com a hora) e a resposta falada é só "Anotado!".
- Use uma palavra explícita (`obsidian`, `diário`, `caderno` ou `nota:`). Um "anota ..." solto pode ser lido como compromisso de agenda.
- Por esta rota só valem os comandos do menu: o pedido livre à IA não roda aqui (seção 2).
- O Obsidian é opcional: abra a pasta `Assist.IA` do Drive nele se quiser links e grafo; o assistente só usa o Drive.

## 5.1 Abrir e fechar o assistente (sessão)

As macros "Falar: ..." ficam **desativadas** e só ligam quando você abre o assistente. Isso evita botões disparando fora do carro.

1. Diga ao Gemini: **"Mande uma mensagem para Copiloto no WhatsApp: abrir assistente"**. É a única vez por viagem que você passa pela confirmação dele.
2. O assistente liga o modo carro e responde exatamente **"Assistente aberto."**
3. A macro **"Assistente aberto"** (gatilho *Notification Received*, app WhatsApp, título contém `Copiloto`, texto contém `Assistente aberto`) **ativa** as macros "Falar: ..." (ação *Enable/Disable Macro*) e fala "Assistente aberto".
4. Ao sair, diga **"fechar assistente"**. A resposta "Assistente fechado." aciona a macro **"Assistente fechado"**, que desativa as macros "Falar".

Frases aceitas: *abrir/iniciar/ativar assistente* e *fechar/encerrar/desativar assistente* (com "o" e "por favor" opcionais). Só valem como mensagem inteira, então "fechar assistente virtual do cliente" não faz nada.

**Atenção:** as respostas "Assistente aberto." e "Assistente fechado." são fixas de propósito, porque o MacroDroid as reconhece. Não altere o texto sem ajustar as macros. Se o gatilho disparar com a sua própria mensagem de pedido, restrinja-o ao app/título do Copiloto e ao texto exato da resposta.

### Macros de apoio (opcionais)

- **Carro conectado:** gatilho *Bluetooth Device Connected* → "Não perturbe" só com prioridades + ajustar volume de notificação.
- **Carro desconectado:** gatilho *Bluetooth Device Disconnected* → desligar o "Não perturbe".

A receita completa está em `docs/macrodroid-modo-carro.json`. Ela **não é um `.mdr` importável**: o formato de exportação do MacroDroid é proprietário, então as macros precisam ser recriadas à mão.

## 6. Problemas comuns

- **A macro não dispara:** confira o gatilho escolhido, a restrição do Bluetooth e a otimização de bateria.
- **Fala "vazio" ou nada:** rode o `curl` e veja se `fala` vem preenchido; depois confira o magic text no `Speak Text`.
- **Fala duas vezes:** o Android Auto também está lendo a notificação. Desligue a leitura do WhatsApp nele.
- **Resposta não continua a conversa:** o menu volta ao início após `IDLE_MENU_MINUTES` (padrão 3) sem resposta.

## 7. Segurança

- A chave vale para ler e-mails e agenda e confirmar ações do menu. Trate-a como senha e use uma por dispositivo.
- A rota não expõe cofre nem IA livre, de propósito.
- Toda chamada é registrada no log da API como `[AUDIT] voice_command` (só o tamanho do texto, não o conteúdo).

## 8. Relação com o uso por WhatsApp

O caminho antigo (Gemini do Android Auto → WhatsApp → assistente) continua funcionando e cobre o que esta rota não cobre: pedidos livres e cofre (fora do carro). As respostas no WhatsApp em modo carro também foram encurtadas (350 caracteres) e sem o "Diga: voltar" desnecessário.

## Referência da rota

`POST /api/public/v1/assistant/command`

- **Escopo:** `assistant:command`
- **Corpo:** `{ "text": string }` (1 a 500 caracteres)
- **Resposta 200:** `{ "fala": string }` (texto limpo para voz)
- Documentada em `openapi.json`, tag *Assistente*.
