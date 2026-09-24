// Heurísticas simples para sinalizar texto externo que tenta dar ordens a um assistente de IA.
const PATTERNS: [RegExp, string][] = [
  [/ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts|rules)/i, "pedido para ignorar instruções anteriores"],
  [/ignor[ea] (todas )?(as )?(instru[çc][õo]es|regras|ordens) (anteriores|acima|passadas)/i, "pedido para ignorar instruções anteriores"],
  [/desconsidere .{0,40}(instru[çc][õo]es|regras)/i, "pedido para desconsiderar regras"],
  [/(system|developer) prompt/i, "menção a prompt de sistema"],
  [/you are now\b|voc[êe] agora [ée]\b/i, "tentativa de mudar o papel do assistente"],
  [/(do not|don't|n[ãa]o) (tell|inform|avise|informe|mencione).{0,30}(user|usu[áa]rio|dono|alexandre)/i, "pedido para esconder informação do dono"],
  [/(forward|encaminhe|reenvie|envie).{0,40}(all|todos|tudo).{0,40}(e-?mails?|mensagens|messages)/i, "pedido para encaminhar e-mails em massa"],
  [/(delete|apague|exclua|remova).{0,20}(all|todos|tudo)/i, "pedido de exclusão em massa"],
  [/(assistente|assistant|ai|ia)[, ]+(please |por favor )?(execute|run|envie|send|responda|reply)/i, "instrução dirigida ao assistente"],
];

export function suspiciousReasons(text: string): string[] {
  const found = new Set<string>();
  for (const [re, why] of PATTERNS) if (re.test(text)) found.add(why);
  return [...found];
}
