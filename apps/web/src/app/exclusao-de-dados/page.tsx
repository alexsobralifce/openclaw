import type { Metadata } from "next";

export const metadata: Metadata = { title: "Exclusão de dados — Assist.IA" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "o contato de suporte informado pela empresa que atende você";

export default function DataDeletionPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 text-gray-300 text-sm leading-relaxed space-y-6">
      <h1 className="text-2xl font-semibold text-gray-100">Exclusão de dados</h1>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Se você usa o assistente e conectou sua conta Google</h2>
        <ol className="list-decimal pl-6 space-y-1">
          <li>Entre no Assist.IA e abra <strong>Canais</strong>; remova a conta Google. O token de acesso é apagado e o Assist.IA deixa de acessar seu Gmail, Agenda, Drive e Contatos.</li>
          <li>Opcionalmente, remova o Assist.IA também em <a className="text-teal-400 underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</li>
          <li>As notas e os contatos criados na pasta <em>Assist.IA</em> do seu Google Drive são seus: apague a pasta no Drive se quiser removê-los.</li>
          <li>Para apagar também sua conta, o histórico do assistente, a memória, a rotina e o cofre de senhas guardados conosco, peça a exclusão por e-mail (abaixo), do endereço cadastrado na conta. Atendemos em até 30 dias.</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Se você é uma empresa que conectou o Instagram</h2>
        <ol className="list-decimal pl-6 space-y-1">
          <li>Entre no Assist.IA e abra <strong>Canais</strong>.</li>
          <li>No canal do Instagram, clique em <strong>Remover</strong>. O token de acesso é apagado e o Assist.IA deixa de receber mensagens da conta.</li>
          <li>Opcionalmente, no Instagram, vá em Configurações › Site e apps (ou Apps e sites) e remova o Assist.IA.</li>
          <li>Para apagar também as conversas e contatos guardados, peça a exclusão por e-mail (abaixo).</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-200">Se você é uma pessoa que escreveu para uma empresa</h2>
        <p>
          Suas mensagens ficam na caixa de entrada da empresa com quem você conversou. Para pedir a exclusão, envie um e-mail para {CONTACT} informando
          seu nome de usuário do Instagram. Removemos as conversas e o contato associados em até 30 dias.
        </p>
      </section>
    </main>
  );
}
