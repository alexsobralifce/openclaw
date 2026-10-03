import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de Privacidade — MagoBox" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "o contato de suporte informado pela empresa que atende você";

const h2 = "text-base font-semibold text-gray-200";
const link = "text-teal-400 underline";

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-gray-300 text-sm leading-relaxed space-y-6">
      <h1 className="text-2xl font-semibold text-gray-100">Política de Privacidade</h1>
      <p className="text-gray-500">Última atualização: 3 de outubro de 2026</p>

      <section className="space-y-2">
        <h2 className={h2}>O que é o MagoBox</h2>
        <p>
          O MagoBox é uma plataforma com duas partes: (1) uma caixa de entrada que reúne as mensagens que empresas recebem em canais como WhatsApp e
          Instagram, e (2) um assistente pessoal, usado pelo WhatsApp e pelo painel, que ajuda o próprio usuário com e-mails, agenda, arquivos, notas,
          contatos e um cofre de senhas. Esta política explica quais dados tratamos, para quê, e como você controla tudo isso.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Dados que tratamos</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Conta:</strong> nome, e-mail, senha (guardada apenas como hash, nunca em texto) e o telefone de WhatsApp que você informa para falar com o assistente.</li>
          <li><strong>Mensagens do assistente:</strong> o que você escreve, fala (áudio) ou envia (PDF, foto) ao assistente, e as respostas dele.</li>
          <li><strong>Caixa de entrada de clientes:</strong> mensagens recebidas e enviadas nos canais conectados (WhatsApp, Instagram), com o nome e o identificador de quem escreveu.</li>
          <li><strong>Dados da sua conta Google</strong>, quando você a conecta (detalhados abaixo).</li>
          <li><strong>Dados do Instagram</strong>, quando uma empresa conecta sua conta profissional (detalhados abaixo).</li>
          <li><strong>Cofre de senhas:</strong> o que você mesmo cadastra, guardado cifrado.</li>
          <li><strong>Memória e rotina do assistente:</strong> preferências e hábitos que você pede para ele lembrar.</li>
          <li><strong>Consumo de IA:</strong> quantidade de chamadas e de tokens por usuário e por dia (apenas números, sem o conteúdo), para controle de custo e de limites de uso.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Dados da sua conta Google</h2>
        <p>Ao conectar uma conta Google, você autoriza, pelo login oficial do Google, os acessos abaixo. Usamos cada um só para a função indicada:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Gmail</strong> (leitura e modificação): ler e buscar e-mails a seu pedido, avisar de e-mails novos, marcar como lido, apagar, arquivar
            e enviar ou responder e-mails. Envios e exclusões só acontecem depois de uma confirmação sua.
          </li>
          <li><strong>Google Agenda:</strong> consultar seus compromissos e criar eventos, depois de você confirmar.</li>
          <li>
            <strong>Google Drive</strong> (leitura de arquivos e criação dos arquivos do próprio app): procurar e enviar a você arquivos que você pedir, e
            gravar suas notas e contatos na pasta <em>Assist.IA</em> do seu Drive. O MagoBox não apaga arquivos do seu Drive e só altera os arquivos que ele mesmo criou.
          </li>
          <li>
            <strong>Contatos</strong> (somente leitura): consultar telefone e e-mail de pessoas a seu pedido. Os contatos são copiados para arquivos de
            texto na pasta <em>Assist.IA</em> do seu próprio Drive.
          </li>
          <li><strong>Identificação</strong> (e-mail da conta): saber qual conta Google foi conectada.</li>
        </ul>
        <p>
          Lemos esses dados sob demanda, quando você pede algo ao assistente, e para avisar de e-mails novos. Para o aviso, uma fila temporária com apenas o
          remetente, o assunto e o horário de cada e-mail novo (sem o corpo da mensagem) fica no nosso banco por até 48 horas. Notas e contatos ficam no seu Drive, sob o seu controle.
        </p>
        <p>
          O uso e a transferência, a qualquer outro aplicativo, das informações recebidas das APIs do Google obedecerão à{" "}
          <a className={link} href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado. (MagoBox&apos;s use and transfer to any other app of information received from Google APIs will adhere to
          the Google API Services User Data Policy, including the Limited Use requirements.)
        </p>
        <p>
          Em especial: usamos os dados do Google apenas para oferecer as funções que você pediu; não os vendemos; não os usamos para publicidade; não os
          usamos para treinar modelos de inteligência artificial; e pessoas da nossa equipe não leem o conteúdo deles, exceto com a sua autorização
          expressa, para investigar abuso ou quando a lei exigir.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Dados do Instagram</h2>
        <p>
          Quando uma empresa conecta sua conta profissional do Instagram, ela autoriza o MagoBox, pelo login oficial do Instagram, a ler e responder as
          mensagens diretas dessa conta. Tratamos apenas:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>identificador, nome de usuário e nome da conta profissional conectada;</li>
          <li>mensagens diretas enviadas à conta e as respostas enviadas por ela (texto e links de anexos);</li>
          <li>identificador e nome público de quem escreveu, para montar a conversa;</li>
          <li>um token de acesso, guardado cifrado, usado para receber e enviar mensagens em nome da empresa.</li>
        </ul>
        <p>Não acessamos senha do Instagram, nem publicamos, curtimos ou seguimos em nome de ninguém.</p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Inteligência artificial</h2>
        <p>
          Para entender seus pedidos, transcrever áudios, ler PDFs e fotos, resumir e redigir rascunhos, enviamos o texto ou o arquivo necessário a
          cada pedido a provedores de IA: <strong>OpenAI</strong>, <strong>Google (Gemini)</strong> e um serviço de classificação de intenção. Enviamos só
          o que o pedido exige, e esses provedores tratam os dados conforme os próprios termos. Não enviamos senhas do cofre à IA, e o assistente é
          instruído a recusar notas que contenham senhas. Respostas da IA podem conter erros; ações sensíveis (enviar e-mail, criar evento) pedem a sua confirmação antes.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Para que usamos</h2>
        <p>
          Exclusivamente para prestar o serviço: mostrar mensagens à equipe e permitir respostas, executar o que você pede ao assistente, avisar de e-mails
          novos, manter a segurança da conta e medir o consumo. Não vendemos dados e não os usamos para publicidade. Não os compartilhamos com terceiros,
          exceto os prestadores necessários ao funcionamento (hospedagem, banco de dados, WhatsApp e provedores de IA citados acima) e quando a lei exigir.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Onde ficam e como protegemos</h2>
        <p>
          Os dados ficam em servidores de nuvem que podem estar fora do Brasil (hoje, nos Estados Unidos). Tokens de acesso do Google e do Instagram e o
          cofre de senhas são guardados cifrados; a comunicação usa HTTPS; cada conta só enxerga os dados do próprio workspace; e administradores da plataforma
          gerenciam usuários e permissões sem ver o conteúdo dos workspaces.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Por quanto tempo guardamos</h2>
        <p>
          Enquanto sua conta estiver ativa. Ao desconectar o Google ou o Instagram, apagamos o token e paramos de acessar os dados. A fila de e-mails novos
          dura até 48 horas. Arquivos criados no seu Drive (notas e contatos) continuam seus: ficam lá até você apagá-los. Registros técnicos e de consumo
          podem ser mantidos por prazo limitado para segurança e auditoria.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Seus direitos e como revogar o acesso</h2>
        <p>
          Você pode pedir acesso, correção, portabilidade e exclusão dos seus dados, e revogar consentimentos, conforme a Lei Geral de Proteção de Dados (LGPD).
          Para revogar o acesso ao Google, desconecte a conta em <strong>Canais</strong> no painel ou remova o MagoBox em{" "}
          <a className={link} href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.
          Veja como pedir a exclusão em <a className={link} href="/exclusao-de-dados">Exclusão de dados</a>. O uso do serviço também
          segue os <a className={link} href="/termos">Termos de Serviço</a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Mudanças nesta política</h2>
        <p>Se mudarmos o que coletamos ou como usamos os dados, atualizamos esta página e a data acima; mudanças relevantes serão avisadas no painel.</p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Contato</h2>
        <p>Dúvidas ou pedidos sobre esta política: {CONTACT}.</p>
      </section>
    </main>
  );
}
