// RECONSTRUÍDO: perdido na recuperação (não estava no GitHub nem foi recuperado das
// transcrições). Extraído do mesmo padrão visual usado em auth/login e auth/register.
import { Logo } from "./Logo";

export const inputClass =
  "w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500/60 transition-colors";

export const buttonClass =
  "w-full bg-violet-500 hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors";

/** Moldura padrão das telas de autenticação (login, cadastro, recuperação de senha). */
export function AuthCard({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="flex justify-center">
            <Logo size={56} className="flex-col !gap-3" textClassName="text-3xl font-bold tracking-tight text-white" />
          </h1>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">{children}</div>
      </div>
    </div>
  );
}
