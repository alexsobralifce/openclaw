/**
 * Documentação do menu do assistente, em árvore: o que cada item faz e como adicionar e apagar.
 * É a fonte da página /dashboard/ajuda. Os `id` dos itens do menu (e-mails, agenda...) precisam bater com `MENU_ITEMS` da API
 * (há um teste que falha se um item novo do menu ficar sem documentação). Só descreva o que o assistente realmente faz:
 * onde ele não cria, edita ou apaga, o texto diz isso e aponta onde fazer.
 */
export interface DocNode {
  id: string;
  icon: string;
  title: string;
  /** O que é e o que faz, em uma ou duas frases */
  summary: string;
  /** O que precisa estar pronto (Google conectado, serviço liberado...) */
  needs?: string;
  /** Frases de exemplo, do jeito que se escreve ou se fala */
  say?: string[];
  /** Como adicionar/criar */
  add?: string;
  /** Como apagar/remover */
  remove?: string;
  /** O que NÃO faz, ou limites importantes */
  limits?: string;
  children?: DocNode[];
}

export const MENU_DOCS: DocNode[] = [
  {
    id: "como-funciona",
    icon: "🧭",
    title: "Como o menu funciona",
    summary: "O assistente responde com listas numeradas. Você escolhe pelo número, pelo nome ou falando.",
    children: [
      { id: "abrir-menu", icon: "🏠", title: "Abrir o menu", summary: "Mostra os itens disponíveis para a sua conta.", say: ["oi", "menu", "ajuda", "bom dia"] },
      { id: "escolher", icon: "🔢", title: "Escolher uma opção", summary: "Responda só com o número. Também vale falar o número, a ordem ou o nome do item.", say: ["2", "dois", "a segunda", "voltar (ou 0)"] },
      { id: "voz", icon: "🎙️", title: "Falar em vez de escrever", summary: "No WhatsApp e no app você pode mandar áudio: ele transcreve, mostra o que entendeu e responde. Tudo que vale por texto vale por voz.", limits: "O código do cofre nunca é aceito por áudio." },
      { id: "livre", icon: "💬", title: "Frases livres", summary: "Fora de um menu, qualquer frase vai para a IA, que entende o que você quer ou usa a tela certa.", say: ["quero a música Catingueira", "o que tenho na agenda sexta?"] },
      { id: "ocioso", icon: "⏱️", title: "Voltar ao menu sozinho", summary: "Depois de 30 minutos parado, o menu esquece a tela. Um número solto reabre o menu principal.", limits: "A conversa recente (últimas 24 h) continua lembrada; para apagar, diga “esquecer a conversa”." },
      { id: "canais", icon: "📱", title: "Onde falar com o assistente", summary: "Os mesmos comandos funcionam nos três canais.", children: [
        { id: "canal-whatsapp", icon: "🟢", title: "WhatsApp", summary: "Pelo número conectado em Canais. Só o número do dono dá comandos; qualquer outro número segue o fluxo normal de cliente." },
        { id: "canal-app", icon: "📲", title: "Aplicativo (este painel)", summary: "Aba Assistente: texto, áudio (microfone), foto ou PDF (clipe) e botão de baixar nos arquivos. Instale o atalho para abrir como app e receber notificações." },
        { id: "canal-telegram", icon: "✈️", title: "Telegram", summary: "Vincule em Assistente › engrenagem › Vincular Telegram.", limits: "O cofre de senhas não funciona por lá (o Telegram não tem criptografia de ponta a ponta)." },
      ] },
    ],
  },
  {
    id: "email",
    icon: "📧",
    title: "E-mails",
    summary: "Ler, responder, apagar e escrever e-mails das suas contas Google, com aviso quando chega e-mail novo.",
    needs: "Conta Google conectada (Canais › Conectar Google) e o serviço E-mail liberado para a sua conta.",
    children: [
      { id: "email-ler", icon: "📥", title: "Ler os não lidos", summary: "Lista os não lidos da conta escolhida, com pessoas antes dos e-mails automáticos. Spam, promoções e remetentes marcados como “sem interesse” ficam fora da lista.", say: ["e-mails", "ler e-mails", "ver ocultos (mostra o que ficou escondido)"] },
      { id: "email-abrir", icon: "📖", title: "Abrir e agir em um e-mail", summary: "Diga o número do e-mail: ele abre com um resumo da IA e as ações Ler, Apagar, Responder, Spam e Sem interesse.", say: ["o número do e-mail", "responder", "apagar", "spam", "próximo"], remove: "Apagar manda para a lixeira do Gmail (dá para recuperar por 30 dias). Spam move para a pasta de spam. “Sem interesse” para de avisar daquele remetente." },
      { id: "email-novo", icon: "✉️", title: "Escrever um e-mail novo", summary: "O assistente pergunta a conta, o destinatário (nome do contato ou endereço), o assunto e o texto, mostra o rascunho e só envia depois do seu “1 enviar”.", say: ["enviar e-mail", "enviar e-mail para Maria"], add: "Diga “enviar e-mail”. Nada é enviado sem a sua confirmação." },
      { id: "email-buscar", icon: "🔎", title: "Buscar e-mails", summary: "Procura no Gmail de todas as contas, por pessoa ou por assunto. Na busca por pessoa ele tolera nome incompleto ou com sufixo (“arnaud jr” acha “Arnaud”).", say: ["e-mails do Marcos", "buscar e-mails sobre contrato"] },
      { id: "email-fila", icon: "⏳", title: "Aviso de e-mail novo e fila", summary: "A cada minuto o assistente checa suas contas. Quando chega e-mail, você recebe um aviso curto com quem mandou e o assunto; eles esperam numa fila.", say: ["fila (mostra a lista)", "próximo (abre o mais antigo)"], limits: "Spam, promoções e remetentes “sem interesse” não avisam. A fila guarda até 50." },
      { id: "email-lote", icon: "🗑️", title: "Apagar ou marcar vários de uma vez", summary: "Na lista de e-mails, cite os números.", say: ["apagar e-mails 1, 2 e 5", "marcar 1 a 4 como lidos"], remove: "Apagar em lote: até 10 por vez, sempre com confirmação, e vão para a lixeira." },
    ],
  },
  {
    id: "agenda",
    icon: "📅",
    title: "Google Agenda",
    summary: "Ver os compromissos e criar eventos nas suas agendas.",
    needs: "Conta Google conectada e o serviço Agenda liberado.",
    children: [
      { id: "agenda-ver", icon: "👀", title: "Ver compromissos", summary: "Hoje, amanhã ou os próximos 7 dias, juntando todas as contas. Com duas contas, uma letra (A, B) mostra de qual é cada evento.", say: ["agenda de hoje", "amanhã", "próximos 7 dias"] },
      { id: "agenda-criar", icon: "➕", title: "Criar um evento", summary: "Descreva do seu jeito. Sem duração, o evento dura 1 hora. Com duas contas, ele pergunta em qual agenda criar.", say: ["marque reunião com o João amanhã às 15h por 1 hora"], add: "Diga o evento e confirme com “1 confirmar” (2 refaz, 0 cancela). Nada é criado sem o seu “sim”." },
      { id: "agenda-foto", icon: "🖼️", title: "Criar eventos por foto ou PDF", summary: "Mande a foto ou o PDF de um convite ou cartaz: ele lê os compromissos e mostra a lista para você confirmar.", add: "Envie o arquivo com a legenda “adicionar na agenda”." },
      { id: "agenda-apagar", icon: "🗑️", title: "Apagar um evento", summary: "Lista os eventos dos próximos 7 dias (de todas as contas), numerados. Você escolhe o número e confirma.", say: ["apagar evento", "5 (na tela da agenda)"], remove: "Diga “apagar evento” (ou a opção 5 da agenda), escolha o número e confirme com “1 apagar” (0 cancela). Em evento que se repete, só a ocorrência escolhida some." },
    ],
    limits: "O assistente cria e apaga eventos, mas não edita. Para mudar horário ou título, use o Google Agenda (ou apague e crie de novo).",
    remove: "Apague pelo assistente (“apagar evento”) ou direto no Google Agenda.",
  },
  {
    id: "clients",
    icon: "💬",
    title: "Conversas de clientes",
    summary: "Acompanhar e responder as conversas de clientes que chegam pelo WhatsApp ou Instagram conectados.",
    needs: "Canal conectado em Canais e o serviço Conversas de clientes liberado.",
    children: [
      { id: "clients-ver", icon: "📋", title: "Ver e abrir conversas", summary: "Lista as conversas abertas e pendentes com a última mensagem; o número abre e mostra as últimas mensagens." },
      { id: "clients-responder", icon: "↩️", title: "Responder", summary: "Diga em poucas palavras o que responder: a IA escreve e você confirma com “1 enviar”.", say: ["responder", "confirmo presença, obrigado"] },
      { id: "clients-resolver", icon: "✅", title: "Marcar como resolvida", summary: "Fecha a conversa e volta à lista.", say: ["resolver"] },
    ],
    add: "Conversas novas aparecem sozinhas quando o cliente escreve para o número ou conta do Instagram conectados.",
    remove: "Excluir uma conversa é no painel web: Inbox › abra a conversa › Excluir (dá para apagar também o contato). Não dá para desfazer.",
  },
  {
    id: "free",
    icon: "🤖",
    title: "Perguntar à IA",
    summary: "Modo livre: escreva ou fale o que precisa. A IA busca e-mails, olha a agenda, procura arquivos e prepara ações.",
    say: ["quais e-mails não lidos na conta da faculdade?", "marque reunião com o João sexta às 15h", "responda a Maria dizendo que o pedido sai amanhã"],
    add: "Peça para criar um evento, enviar um e-mail ou responder um cliente: ela monta e pede “1 confirmar”.",
    remove: "Para apagar o que o assistente lembra da conversa recente (24 h), diga “esquecer a conversa”.",
    limits: "Nada é enviado nem criado sem o seu “sim”. Textos de e-mails e de clientes são tratados como dados, não como ordens.",
  },
  {
    id: "memory",
    icon: "🧠",
    title: "Minha memória",
    summary: "O que o assistente guardou sobre você (preferências, jeito de responder). Os próximos rascunhos já saem no seu jeito.",
    say: ["lembre que respondo o João de forma informal"],
    add: "Diga “lembre que …” em uma mensagem separada.",
    remove: "Abra Minha memória e digite o número do item para esquecer, ou diga “esqueça o que eu disse sobre o João”.",
    limits: "Por segurança, ele não guarda memória no mesmo comando em que leu e-mails ou mensagens de terceiros.",
  },
  {
    id: "drive",
    icon: "📁",
    title: "Google Drive",
    summary: "Procura um arquivo (música, foto, PDF, planilha, documento) pelo nome em todas as suas contas e manda aqui. Um resultado exato vai direto; vários viram uma lista numerada.",
    needs: "Conta Google conectada e o serviço Drive liberado.",
    say: ["me manda a música Evidências", "quero a música Catingueira", "contrato de aluguel", "baixe a planilha de gastos"],
    children: [
      { id: "drive-pedir", icon: "🎵", title: "Pedir um arquivo", summary: "Diga o nome ou parte dele (e o tipo, se quiser). Tolera erro de digitação e, quando não acha igual, mostra os parecidos. Responda com o número para receber." },
      { id: "drive-app", icon: "⬇️", title: "No aplicativo", summary: "Cada item da lista tem um botão de baixar, e o arquivo escolhido chega como cartão com o botão de baixar." },
    ],
    add: "Para ter um arquivo disponível, coloque-o no seu Google Drive (pelo app do Google ou pelo computador). O assistente só procura e envia.",
    remove: "O assistente não apaga arquivos do Drive. Apague no próprio Google Drive.",
    limits: "Arquivos acima de 15 MB não são enviados: ele manda o link do Drive.",
  },
  {
    id: "notes",
    icon: "📝",
    title: "Notas",
    summary: "Guarda anotações no seu Google Drive, organizadas por assunto, e acha o que você anotou.",
    needs: "Conta Google conectada e o serviço Drive liberado. As notas ficam na conta @gmail, na pasta Assist.IA.",
    children: [
      { id: "notes-criar", icon: "✍️", title: "Criar uma nota", summary: "Por assunto, ou solta (vai para a nota do dia).", say: ["nota sobre Contrato: o prazo vence dia 10", "anota ligar pro Marcos"], add: "Escreva “nota sobre <assunto>: <texto>” ou “anota <texto>”." },
      { id: "notes-arquivo", icon: "📄", title: "Criar nota a partir de PDF ou foto", summary: "Mande o arquivo: ele lê, resume, escolhe o assunto e cria a nota.", add: "Envie o PDF ou a foto, de preferência com a legenda “nota sobre <assunto>”." },
      { id: "notes-ler", icon: "📂", title: "Ler as notas", summary: "“Notas” mostra os assuntos; o número abre o assunto e depois a nota.", say: ["notas", "notas de contrato"] },
      { id: "notes-buscar", icon: "🔎", title: "Buscar nas notas", summary: "Procura trechos nas suas anotações e no Drive.", say: ["o que anotei sobre o contrato?"] },
      { id: "notes-concluir", icon: "✅", title: "Concluir e apagar uma nota", summary: "Quando a anotação já cumpriu o papel, conclua: a nota vai para a lixeira do Google Drive e você pode recuperá-la por 30 dias.", say: ["concluir 2 (na lista do assunto)", "concluir (com a nota aberta)"], remove: "Abra a nota e escolha “1 Concluir e apagar”, ou na lista do assunto diga “concluir 2”. Confirme com “1 apagar” (0 cancela)." },
    ],
    remove: "Pelo assistente: concluir a nota (ela vai para a lixeira do Drive, 30 dias). Também dá para apagar na pasta Assist.IA do seu Google Drive.",
    limits: "Ele recusa guardar senhas em notas: use o cofre. Só consegue apagar as notas que ele mesmo criou; uma nota que você colocou à mão na pasta deve ser apagada pelo Drive.",
  },
  {
    id: "contacts",
    icon: "📇",
    title: "Contatos",
    summary: "Acha telefone e e-mail de uma pessoa nos seus contatos do Google e nos endereços de quem já te escreveu.",
    needs: "Conta Google conectada e o serviço Drive liberado (a lista fica guardada no Drive).",
    say: ["telefone do Marcos", "e-mail da Maria", "atualizar contatos", "atualizar banco de e-mails"],
    add: "Adicione o contato no Google Contatos e diga “atualizar contatos”. Quem já te escreveu por e-mail também é encontrado (“atualizar banco de e-mails”).",
    remove: "O assistente só lê. Apague no Google Contatos e diga “atualizar contatos”.",
    limits: "Aceita nome incompleto ou parecido (“arnaud jr” acha “Arnaud”); na dúvida, mostra os candidatos.",
  },
  {
    id: "routine",
    icon: "🗓️",
    title: "Minha rotina",
    summary: "Sua rotina semanal (aulas, academia, plantões). O assistente lembra disso ao sugerir horários.",
    say: ["toda terça e quinta tenho aula às 19h", "academia seg, qua e sex às 6h"],
    add: "Conte a rotina em uma frase. Quando algo mudar, avise que ele atualiza.",
    remove: "Abra Minha rotina e digite o número do item para remover.",
  },
  {
    id: "vault",
    icon: "🔐",
    title: "Cofre de senhas",
    summary: "Consulta, pelo assistente, as senhas que você liberou, com um código de 4 dígitos.",
    needs: "Cofre criado e código de 4 dígitos definido no painel web (Cofre de senhas), e o serviço Cofre liberado.",
    say: ["cofre", "senha do github", "bloquear cofre"],
    add: "Criar o cofre, a senha mestra, o código de 4 dígitos e adicionar entradas é só no painel web. Marque as entradas que podem ser consultadas por mensagem.",
    remove: "Apagar entradas é só no painel web (Cofre de senhas).",
    limits: "Nunca funciona no Telegram. A resposta com senha some do chat depois de alguns instantes. Códigos errados em sequência bloqueiam o WhatsApp até você digitar a senha mestra no painel.",
  },
  {
    id: "config",
    icon: "⚙️",
    title: "Configurações",
    summary: "Ajustes do assistente. Este item nunca some do menu.",
    say: ["configurações"],
    children: [
      { id: "config-limpeza", icon: "🧹", title: "Limpeza do chat", summary: "Apaga automaticamente as respostas do assistente no WhatsApp a cada intervalo que você escolher, ou na hora (“Limpar agora”).", limits: "Só apaga mensagens enviadas pelo número conectado, de até 2 dias. As suas mensagens para ele o WhatsApp não deixa apagar: limpe por lá." },
      { id: "config-itens", icon: "🙈", title: "Itens do menu", summary: "Esconda do menu os itens que você não usa. O comando escrito ou falado continua valendo.", add: "Painel web › Configurações › Menu do WhatsApp: desmarque para mostrar de novo.", remove: "No mesmo lugar, marque os itens que quer esconder." },
      { id: "config-cidade", icon: "🌦️", title: "Cidade do clima", summary: "O menu mostra o clima do lugar onde você está.", say: ["minha cidade é Recife"], add: "Diga a cidade ou envie a sua localização (📎 › Localização)." },
      { id: "config-canal", icon: "🔔", title: "Canal dos avisos", summary: "Onde o assistente fala primeiro com você (e-mail novo, lembretes): WhatsApp, app ou Telegram.", add: "No app: Assistente › engrenagem › escolha o canal." },
    ],
  },
];

/** Sem acento nem maiúscula, para a busca. */
const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Todo o texto de um item (sem os filhos), para a busca. */
export function docText(n: DocNode): string {
  return flat([n.title, n.summary, n.needs, n.add, n.remove, n.limits, ...(n.say ?? [])].filter(Boolean).join(" "));
}

/**
 * Filtra a árvore pela busca: fica o item que casa e os caminhos até ele. Se o item casa, vão junto todos os filhos;
 * se só um filho casa, o pai fica com os filhos que casam.
 */
export function filterDocs(nodes: DocNode[], query: string): DocNode[] {
  const terms = flat(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return nodes;
  const match = (n: DocNode) => {
    const t = docText(n);
    return terms.every((w) => t.includes(w));
  };
  const walk = (list: DocNode[]): DocNode[] =>
    list.flatMap((n) => {
      if (match(n)) return [n];
      const kids = n.children ? walk(n.children) : [];
      return kids.length ? [{ ...n, children: kids }] : [];
    });
  return walk(nodes);
}

/** Quantos itens a árvore tem (todos os níveis). */
export const countDocs = (nodes: DocNode[]): number => nodes.reduce((sum, n) => sum + 1 + (n.children ? countDocs(n.children) : 0), 0);
