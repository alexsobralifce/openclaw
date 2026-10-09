import type { Metadata } from "next";
import { UmamiRecorder } from "@/components/landing/umami-recorder";

export const metadata: Metadata = { title: "Termos de Serviço", alternates: { canonical: "/termos" } };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "o contato de suporte informado pela empresa que atende você";

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-gray-300 text-sm leading-relaxed space-y-6">
      <UmamiRecorder />
      <h1 className="text-2xl font-semibold text-gray-100">Termos de Serviço</h1>
      <p className="text-gray-500">Última atualização: 3 de outubro de 2026</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">1. O serviço</h2>
        <p>
          O MagoBox é uma plataforma de atendimento que reúne, em uma caixa de entrada, as mensagens que uma empresa recebe em canais como WhatsApp,
          e-mail e Instagram, e permite que a equipe responda, organize conversas e automatize tarefas. Inclui também um assistente pessoal, usado pelo
          WhatsApp e pelo painel, que ajuda o usuário com e-mails, agenda, arquivos, notas, contatos e um cofre de senhas. Ao criar uma conta ou conectar um canal, você
          concorda com estes termos.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">2. Conta e responsabilidades</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Você é responsável pelas informações da conta, por manter suas credenciais em segredo e pelo que a sua equipe faz no sistema.</li>
          <li>Você declara ter autorização para conectar as contas e os números que cadastrar (por exemplo, a conta profissional do Instagram da sua empresa).</li>
          <li>Você é o responsável pelo conteúdo das mensagens que envia e pelo atendimento prestado aos seus clientes.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">3. Uso permitido</h2>
        <p>É proibido usar o serviço para:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>enviar spam, mensagens em massa não solicitadas ou conteúdo enganoso, ilegal ou ofensivo;</li>
          <li>violar os termos e políticas das plataformas conectadas (Meta/Instagram, WhatsApp e Google), incluindo a janela de resposta de 24 horas do Instagram;</li>
          <li>tentar acessar dados de outras empresas, contornar limites técnicos ou comprometer a segurança do serviço.</li>
        </ul>
        <p>Podemos limitar ou suspender contas que violem estas regras.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">4. Assistente e inteligência artificial</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>O assistente usa inteligência artificial e pode errar: confira o que ele lê, resume ou redige antes de agir com base nisso.</li>
          <li>Ações sensíveis, como enviar e-mail, criar evento ou responder um cliente, só acontecem depois da sua confirmação. Você é responsável por confirmá-las.</li>
          <li>Não guarde senhas em notas nem as peça ao assistente; para isso existe o cofre de senhas do painel. O assistente recusa notas que contenham senhas.</li>
          <li>Seus pedidos e arquivos são enviados a provedores de IA para serem processados, como descrito na <a className="text-violet-400 underline" href="/privacidade">Política de Privacidade</a>.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">5. Conta Google</h2>
        <p>
          Ao conectar sua conta Google você autoriza o acesso descrito na Política de Privacidade (Gmail, Agenda, Drive e Contatos), usado apenas
          para as funções que você pedir. Você pode revogar o acesso a qualquer momento, desconectando a conta em Canais ou em
          myaccount.google.com/permissions. O uso dos dados do Google segue a Política de Dados do Usuário dos Serviços de API do Google, incluindo os
          requisitos de Uso Limitado. Notas e contatos criados na pasta Assist.IA do seu Drive continuam sendo seus.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">6. Limites de uso</h2>
        <p>
          O uso de inteligência artificial tem um custo, por isso cada plano (Aprendiz, Mago e Arquimago) tem limites: uso mensal de IA, número de contas
          Google, páginas por PDF e duração de cada áudio. Os limites do seu plano aparecem em Configurações, junto com quanto você já usou no mês. Ao
          atingir o limite de IA, as funções que dependem dela (respostas livres, áudio, leitura de arquivos) ficam indisponíveis até o mês seguinte, e o
          menu do assistente continua funcionando. Arquivos acima do limite de páginas ou de duração do seu plano não são processados. Podemos ajustar os
          limites, avisando no painel, e, em caso de uso abusivo, restringir a conta.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">7. Canais de terceiros</h2>
        <p>
          O MagoBox depende de serviços de terceiros (como a API do Instagram e o WhatsApp). Eles têm regras próprias, podem mudar ou ficar
          indisponíveis, e podem suspender contas. Não controlamos esses serviços e não garantimos que estarão sempre disponíveis. Você pode
          desconectar um canal a qualquer momento, em Canais.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">8. Dados e privacidade</h2>
        <p>
          O tratamento de dados está descrito na <a className="text-violet-400 underline" href="/privacidade">Política de Privacidade</a>. Para pedir a
          exclusão de dados, veja <a className="text-violet-400 underline" href="/exclusao-de-dados">Exclusão de dados</a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">9. Disponibilidade e limitação de responsabilidade</h2>
        <p>
          Trabalhamos para manter o serviço disponível, mas ele é oferecido no estado em que se encontra, sem garantia de funcionamento
          ininterrupto. Na medida permitida pela lei, não respondemos por perdas indiretas, lucros cessantes ou por falhas causadas por serviços
          de terceiros.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">10. Encerramento</h2>
        <p>
          Você pode encerrar o uso a qualquer momento, desconectando os canais e pedindo a exclusão da conta. Podemos suspender ou encerrar o acesso
          em caso de violação destes termos ou de risco à segurança do serviço.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">11. Alterações e lei aplicável</h2>
        <p>
          Podemos atualizar estes termos; a data no topo indica a versão vigente. Estes termos são regidos pelas leis do Brasil.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Contato</h2>
        <p>Dúvidas sobre estes termos: {CONTACT}.</p>
      </section>
    </main>
  );
}
