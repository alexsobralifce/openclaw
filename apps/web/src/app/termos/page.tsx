import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Serviço — Assist.IA" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "o contato de suporte informado pela empresa que atende você";

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-gray-300 text-sm leading-relaxed space-y-6">
      <h1 className="text-2xl font-semibold text-gray-100">Termos de Serviço</h1>
      <p className="text-gray-500">Última atualização: 25 de setembro de 2026</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">1. O serviço</h2>
        <p>
          O Assist.IA é uma plataforma de atendimento que reúne, em uma caixa de entrada, as mensagens que uma empresa recebe em canais como WhatsApp,
          e-mail e Instagram, e permite que a equipe responda, organize conversas e automatize tarefas. Ao criar uma conta ou conectar um canal, você
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
        <h2 className="text-base font-semibold text-gray-200">4. Canais de terceiros</h2>
        <p>
          O Assist.IA depende de serviços de terceiros (como a API do Instagram e o WhatsApp). Eles têm regras próprias, podem mudar ou ficar
          indisponíveis, e podem suspender contas. Não controlamos esses serviços e não garantimos que estarão sempre disponíveis. Você pode
          desconectar um canal a qualquer momento, em Canais.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">5. Dados e privacidade</h2>
        <p>
          O tratamento de dados está descrito na <a className="text-teal-400 underline" href="/privacidade">Política de Privacidade</a>. Para pedir a
          exclusão de dados, veja <a className="text-teal-400 underline" href="/exclusao-de-dados">Exclusão de dados</a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">6. Disponibilidade e limitação de responsabilidade</h2>
        <p>
          Trabalhamos para manter o serviço disponível, mas ele é oferecido no estado em que se encontra, sem garantia de funcionamento
          ininterrupto. Na medida permitida pela lei, não respondemos por perdas indiretas, lucros cessantes ou por falhas causadas por serviços
          de terceiros.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">7. Encerramento</h2>
        <p>
          Você pode encerrar o uso a qualquer momento, desconectando os canais e pedindo a exclusão da conta. Podemos suspender ou encerrar o acesso
          em caso de violação destes termos ou de risco à segurança do serviço.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">8. Alterações e lei aplicável</h2>
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
