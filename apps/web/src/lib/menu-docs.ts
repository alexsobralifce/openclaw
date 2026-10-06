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
    summary: "Listas com itens que você edita e marca, e que podem chegar como lembrete na data e hora que você escolher.",
    needs: "Nada além do assistente. Notas não são para guardar documentos: para PDFs existe Documentos.",
    children: [
      { id: "notes-criar", icon: "✍️", title: "Criar uma nota", summary: "Um título e a lista de itens. Pode criar de uma vez só, escrevendo tudo numa mensagem.", say: ["nota compras: leite, pão, ovos", "notas (e escolha ➕ Nova nota)"], add: "Escreva “nota <título>: <item>, <item>…” ou abra Notas e escolha “Nova nota”: o assistente pede o título e depois os itens." },
      { id: "notes-ler", icon: "📂", title: "Ver as notas", summary: "“Notas” lista todas, com a contagem de itens e o horário do lembrete. O número abre a nota; escrever o título também.", say: ["notas", "compras"] },
      { id: "notes-editar", icon: "✏️", title: "Editar a nota", summary: "Adicionar itens, mudar o texto de um item, tirar itens, marcar ou desmarcar e mudar o título.", say: ["feito 2", "marcar 1 e 3"], add: "Abra a nota e escolha “1 Editar”. Para marcar um item como feito, basta dizer “feito 2”." },
      { id: "notes-lembrete", icon: "⏰", title: "Receber a nota como lembrete", summary: "Marque uma data e hora e o assistente manda a nota completa, no seu canal principal (WhatsApp, app ou Telegram).", say: ["amanhã 9h", "sexta 8h", "15/10 às 14h", "daqui a 2 horas"], add: "Abra a nota, escolha “2 Marcar lembrete” e diga quando.", remove: "Na mesma tela, diga “remover”." },
      { id: "notes-ia", icon: "🤖", title: "Pedir em linguagem natural", summary: "Na conversa livre, o assistente também cria e muda notas e lembretes: ele pergunta a hora se faltar.", say: ["me lembra de pagar a luz sexta às 9h", "faz uma lista de compras: leite, pão e ovos", "marca o item 2 da lista de compras", "o que tem na minha lista de compras?"] },
      { id: "notes-apagar", icon: "🗑️", title: "Apagar uma nota", summary: "Apaga a nota, os itens e o lembrete. Pede confirmação antes.", remove: "Abra a nota, escolha “3 Apagar” e confirme com “1”. O 0 cancela." },
    ],
    remove: "Abra a nota e escolha “3 Apagar” (ou use o painel, em Notas). Pode ter quantas notas quiser.",
    limits: "Até 50 itens por nota. O lembrete é enviado uma vez, na hora marcada; se o canal estiver fora do ar, o assistente tenta de novo por algumas horas. As anotações antigas em Markdown continuam no seu Google Drive (pasta Assist.IA), sem mudança, mas não aparecem mais no menu. “Anota no obsidian: …” segue gravando na nota do dia do Drive.",
  },
  {
    id: "spotify",
    icon: "🎧",
    title: "Spotify",
    summary: "Toca e controla o seu Spotify, acha músicas por nome ou assunto, cria playlists e sugere músicas pelo clima e pelo lugar onde você está.",
    needs: "Spotify conectado em Canais (no painel) e o serviço Spotify liberado. Controlar a reprodução exige conta Premium e o app do Spotify aberto em algum aparelho.",
    say: ["spotify", "meus aparelhos"],
    children: [
      { id: "spotify-link", icon: "🔗", title: "Buscar música ou playlist com link", summary: "Diga o que procura e o assistente devolve até 5 resultados, cada um com o link do Spotify. Ao tocar no link, abre direto no app. Não precisa conectar a conta nem ter Premium.", say: ["buscar música catingueira", "buscar playlist de forró", "link da música Asa Branca", "playlists para estudar"] },
      { id: "spotify-tocar", icon: "▶️", title: "Tocar e controlar", summary: "Diga o nome da música ou do artista. Se houver dúvida entre resultados, ele mostra uma lista e o número toca. Sem aparelho ativo, passa a tocar no primeiro disponível.", say: ["tocar catingueira", "ouvir legião urbana", "pausar", "continuar", "pular música", "música anterior", "volume 40", "o que está tocando"] },
      { id: "spotify-assunto", icon: "🔎", title: "Buscar música por assunto", summary: "A IA pensa em consultas para o assunto e o Spotify devolve as músicas reais; escolha pelo número para tocar.", say: ["músicas sobre saudade", "músicas que falam de viagem"] },
      { id: "spotify-clima", icon: "🌦️", title: "Música pelo clima e lugar", summary: "Sugere músicas que combinam com o tempo e o lugar onde você está (o mesmo do menu de clima).", say: ["música para o clima de hoje", "toca alguma coisa"] },
      { id: "spotify-playlist", icon: "📝", title: "Criar uma playlist", summary: "Monta uma playlist privada na sua conta com até 20 músicas e devolve o link.", say: ["criar playlist para estudar", "criar playlist de forró"], add: "Diga “criar playlist para <assunto>”. Ela aparece na sua biblioteca do Spotify." },
    ],
    add: "Conectar a conta em Canais e criar playlists (veja “Criar uma playlist”).",
    remove: "Desconectar o Spotify em Canais. As playlists criadas ficam na sua conta: apague pelo próprio Spotify.",
    limits: "Com “tocar” e “ouvir” o Spotify responde (quando está conectado); para receber um ARQUIVO de música do Drive, diga “quero a música X” ou “baixe a música X”. O assistente não apaga nem edita playlists existentes.",
  },
  {
    id: "docs",
    icon: "📚",
    title: "Documentos",
    summary: "Seus PDFs guardados no Drive e catalogados com título, assunto, tags e resumo, para achar depois pelo assunto.",
    needs: "Conta Google conectada e o serviço Drive liberado. Os arquivos ficam em Assist.IA/Documentos, na conta @gmail.",
    say: ["documentos", "documentos com a tag contrato", "tags"],
    children: [
      { id: "docs-guardar", icon: "📄", title: "Guardar um PDF", summary: "Mande o PDF no chat. A IA lê, sugere título, assunto e de 3 a 6 tags, e o arquivo vai para o Drive com a ficha no catálogo. Na legenda você pode dizer o assunto ou as tags.", add: "Envie o PDF (pelo WhatsApp, pelo app ou pelo clipe do chat). Se quiser uma nota em vez de documento, ponha “nota” na legenda; para criar eventos, “adicionar na agenda”." },
      { id: "docs-buscar", icon: "🔎", title: "Buscar por tag ou assunto", summary: "Acha pela tag, pelo título, pelo assunto e pelo resumo, sem acento. Um resultado só já abre o documento e manda o PDF; vários viram lista numerada (no app, com botão de baixar em cada um).", say: ["documentos com a tag aluguel", "documentos sobre plano de saúde", "tag contrato", "todos"] },
      { id: "docs-biblioteca", icon: "🗂️", title: "Biblioteca no painel", summary: "No painel, a página Documentos mostra tudo em cartões, com busca, filtro por tag, botão de baixar e edição das tags.", add: "Para guardar um PDF novo, mande-o no chat do Assistente ou pelo WhatsApp (a biblioteca do painel é para consultar, editar e baixar).", remove: "Em cada cartão, “Apagar” (com confirmação) manda o PDF para a lixeira do Drive." },
      { id: "docs-reclassificar", icon: "♻️", title: "Reclassificar as notas antigas de PDF", summary: "As notas que você já criou a partir de PDFs entram no catálogo com tags sugeridas pela IA. As notas originais não são alteradas nem apagadas. Roda em lotes de 5.", say: ["reclassificar notas", "continuar reclassificação"], limits: "Como o PDF original dessas notas nunca foi guardado, a ficha é do tipo nota (sem arquivo para baixar)." },
      { id: "docs-categorias", icon: "📂", title: "Categorias dos documentos", summary: "Cada documento tem uma categoria (a IA sugere ao guardar, e você cria as suas). “Categorias” mostra todas com a contagem; o número abre a lista.", say: ["categorias", "categoria saúde", "categoria: Finanças", "categoria do documento 2: Trabalho"], add: "Com o documento aberto, diga “categoria: Saúde” (ou escolha “Mudar categoria”). Categoria nova nasce na hora, é só dizer o nome.", remove: "Uma categoria some quando nenhum documento usa mais o nome; é só trocar a categoria dos documentos." },
      { id: "docs-tags", icon: "🏷️", title: "Ver e editar as tags", summary: "“Tags” mostra as tags e quantos documentos cada uma tem. A IA sugere as tags ao guardar; você muda quando quiser.", say: ["tags", "tags: contrato, aluguel", "adicionar tag imóvel", "tirar tag antigo", "tags do documento 2: saúde"], add: "Com o documento aberto: “adicionar tag imóvel” acrescenta; “tags: contrato, aluguel” troca todas. Até 8 tags por documento, sem acento.", remove: "“tirar tag antigo” remove só essa tag." },
    ],
    add: "Guardar um PDF novo (veja “Guardar um PDF”).",
    remove: "Abra o documento e escolha “3 Apagar”, e confirme: o PDF vai para a lixeira do Google Drive (30 dias) e a ficha sai do catálogo.",
    limits: "PDF de até 15 MB e o teto de páginas do seu plano. Só apaga os PDFs que o assistente guardou; um arquivo seu no Drive deve ser apagado pelo Drive.",
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
      { id: "config-cidade", icon: "🌦️", title: "Cidade do clima", summary: "O menu mostra o clima do lugar onde você está (pelo Google, quando o servidor tem a chave; senão, pelo Open-Meteo).", say: ["minha cidade é Recife"], add: "Diga a cidade ou envie a sua localização (📎 › Localização)." },
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
