import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de Privacidade — Assist.IA" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "o contato de suporte informado pela empresa que atende você";

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-gray-300 text-sm leading-relaxed space-y-6">
      <h1 className="text-2xl font-semibold text-gray-100">Política de Privacidade</h1>
      <p className="text-gray-500">Última atualização: 25 de setembro de 2026</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">O que é o Assist.IA</h2>
        <p>
          O Assist.IA é uma plataforma de atendimento que reúne, em uma única caixa de entrada, as mensagens que empresas recebem em canais como
          WhatsApp, e-mail e Instagram. A empresa que usa o Assist.IA (nosso cliente) decide quem atende e como.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Dados do Instagram que tratamos</h2>
        <p>
          Quando uma empresa conecta sua conta profissional do Instagram, ela autoriza o Assist.IA, pelo login oficial do Instagram, a ler e responder
          as mensagens diretas dessa conta. Tratamos apenas:
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
        <h2 className="text-base font-semibold text-gray-200">Para que usamos</h2>
        <p>
          Exclusivamente para exibir as mensagens à equipe da empresa e permitir que ela responda. Não vendemos dados, não os usamos para publicidade
          e não os compartilhamos com terceiros, exceto prestadores de infraestrutura necessários ao funcionamento do serviço (hospedagem e banco de dados).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Por quanto tempo guardamos</h2>
        <p>
          Enquanto a conta da empresa estiver ativa. Ao desconectar o Instagram, o token é apagado e paramos de receber mensagens. Dados de conversas
          são removidos a pedido, conforme abaixo.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Seus direitos e exclusão de dados</h2>
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados. Veja como em{" "}
          <a className="text-teal-400 underline" href="/exclusao-de-dados">Exclusão de dados</a>. O uso do serviço também
          segue os <a className="text-teal-400 underline" href="/termos">Termos de Serviço</a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Contato</h2>
        <p>Dúvidas sobre esta política: {CONTACT}.</p>
      </section>
    </main>
  );
}
