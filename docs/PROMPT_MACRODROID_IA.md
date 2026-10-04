Você é especialista em MacroDroid (Android). Crie, para o MacroDroid, as macros descritas no JSON abaixo.

## Objetivo

Falar com meu assistente pessoal no carro, sem o Gemini e sem WhatsApp. Cada macro faz UMA chamada HTTP à minha API e fala a resposta pelo celular (som do carro). Quando eu toco o gatilho, o celular fala, por exemplo, meus e-mails novos.

## Como a API funciona

- Endereço: POST https://api-production-f2743.up.railway.app/api/public/v1/assistant/command?formato=texto
- Autenticação: cabeçalho `Authorization: Bearer <CHAVE>` (eu preencho a chave depois; deixe o texto <CHAVE> no lugar)
- Cabeçalho `Content-Type: application/json`
- Corpo: JSON com o campo `text`. Vários comandos podem ir seguidos, separados por ponto e vírgula (máx. 4).
- Resposta: com `?formato=texto`, o corpo da resposta já é só a frase para falar (texto puro). NÃO é JSON, então NÃO use a ação JSON Parse.
- O assistente guarda a conversa entre chamadas (ex.: depois de "ler e-mails", o comando "próximo" continua).

## Regras para as macros

1. Cada macro tem exatamente 2 ações, nesta ordem:
   - HTTP Request (POST), com a opção de bloquear as próximas ações até terminar LIGADA, salvando o corpo da resposta numa variável local de texto chamada `resposta`.
   - Speak Text, com o texto exatamente `{lv=resposta}` (variável local entre chaves, inserida pelo seletor de magic text), no fluxo de áudio de mídia. Sem as chaves o app fala o nome da variável.
2. Use aspas retas (") no JSON do corpo, nunca aspas curvas.
3. Gatilho: botão flutuante (Floating Button) ou widget. Não adicione restrições nem outras ações.
4. As macros "Falar: ..." devem ser criadas DESATIVADAS (disabled).
5. Não coloque a chave de API em nenhum lugar: deixe `<CHAVE>`.

## JSON das macros

```json
{
  "api": {
    "metodo": "POST",
    "url": "https://api-production-f2743.up.railway.app/api/public/v1/assistant/command?formato=texto",
    "cabecalhos": {
      "Authorization": "Bearer <CHAVE>",
      "Content-Type": "application/json"
    },
    "bloqueante": true,
    "salvar_resposta_em": "resposta"
  },
  "macros": [
    { "nome": "Falar: e-mails Pessoal", "corpo": { "text": "ler e-mails; Pessoal" }, "desativada": true },
    { "nome": "Falar: e-mails IFCE", "corpo": { "text": "ler e-mails; IFCE" }, "desativada": true },
    { "nome": "Falar: agenda de hoje", "corpo": { "text": "agenda de hoje" }, "desativada": true },
    { "nome": "Falar: próximo", "corpo": { "text": "próximo" }, "desativada": true },
    { "nome": "Falar: sim", "corpo": { "text": "sim" }, "desativada": true }
  ],
  "macros_de_sessao": [
    {
      "nome": "Assistente aberto",
      "gatilho": "Notification Received, app WhatsApp, título contém \"Copiloto\", texto contém \"Assistente aberto\"",
      "acoes": ["Enable/Disable Macro: ativar todas as macros que começam com \"Falar:\"", "Speak Text: Assistente aberto"]
    },
    {
      "nome": "Assistente fechado",
      "gatilho": "Notification Received, app WhatsApp, título contém \"Copiloto\", texto contém \"Assistente fechado\"",
      "acoes": ["Enable/Disable Macro: desativar todas as macros que começam com \"Falar:\"", "Speak Text: Assistente fechado"]
    }
  ]
}
```

## O que eu espero de você

1. Para cada macro do JSON, diga o gatilho, as 2 ações e o valor de cada campo, em passos curtos e numerados, usando os nomes das ações em inglês como aparecem no app.
2. Se algum campo ou ação não existir na minha versão, diga qual e qual a alternativa mais próxima.
3. Termine com uma checklist de 5 itens para eu conferir se a macro está certa (cabeçalhos, corpo com aspas retas, bloqueio ligado, variável `resposta`, texto falado).
