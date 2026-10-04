// Comandos do Spotify (lógica pura): o que o dono escreve ou fala → o que fazer. `flat` = texto normalizado (minúsculas, sem acento nem pontuação).

export type SpotifyCmd =
  | { kind: "home" }
  | { kind: "play"; query: string }
  | { kind: "resume" }
  | { kind: "pause" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "volume"; percent: number }
  | { kind: "now" }
  | { kind: "devices" }
  | { kind: "playlist"; subject: string }
  | { kind: "about"; subject: string }
  | { kind: "mood" };

/** Fala de outro assunto: arquivo do Drive, e-mail, agenda... Não é pedido de música. */
const OTHER_TOPIC = /\b(drive|arquivo|arquivos|pdf|planilha|nota|notas|e-?mails?|agenda|evento|documentos?)\b/;
const VERB_PLAY = "(?:tocar|toca|toque|colocar|coloca|coloque|poe|ponha|botar|bota|ouvir|escutar|play)";
const ARTICLE = "(?:a |o |as |os |uma |um |umas |uns )?";
const THING = "(?:musica |musicas |faixa |cancao |artista |banda |album |disco |playlist )?";
const VAGUE = /^(algo|alguma coisa|qualquer coisa|alguma musica|uma musica|um som|algum som|qualquer musica)$/;

export function spotifyCommand(flat: string): SpotifyCmd | null {
  const t = flat.replace(/\s+/g, " ").trim();
  if (!t || OTHER_TOPIC.test(t)) return null;
  let m: RegExpMatchArray | null;

  if (/^(?:abrir |ver |meu )?spotify$/.test(t)) return { kind: "home" };
  if (/^(?:pausar|pausa|pare|parar|para)(?: a| o)?(?: musica| som| spotify| tudo)?(?: no spotify)?$/.test(t)) return { kind: "pause" };
  if (/^(?:continuar|continua|retomar|retoma|tocar|toca|play|voltar a tocar)(?: a| o)?(?: musica| som| spotify)?$/.test(t)) return { kind: "resume" };
  if (/^(?:pular|pula|passar|passa)(?: a| essa)?(?: musica| faixa)$|^(?:proxima|seguinte)(?: musica| faixa)$/.test(t)) return { kind: "next" };
  if (/^(?:musica|faixa) anterior$|^voltar(?: a| para a)?(?: musica| faixa)(?: anterior)?$/.test(t)) return { kind: "previous" };
  if ((m = t.match(/^(?:colocar |por |deixar |ajustar |mudar )?(?:o )?(?:volume|som)(?: (?:em|para|pra|no|a|de))? (\d{1,3})(?: ?%| por cento)?$/))) return { kind: "volume", percent: Math.min(100, Number(m[1])) };
  if (/^(?:volume|som) (?:no )?maximo$/.test(t)) return { kind: "volume", percent: 100 };
  if (/^(?:volume|som) (?:no )?minimo$|^(?:mudo|silenciar)$/.test(t)) return { kind: "volume", percent: 0 };
  if (/^(?:o que|que musica|qual musica) (?:esta|ta) tocando(?: agora)?$|^tocando agora$|^que musica e essa$/.test(t)) return { kind: "now" };
  if (/^(?:meus )?(?:aparelhos|dispositivos)(?: do spotify)?$/.test(t)) return { kind: "devices" };
  if ((m = t.match(/^(?:criar|crie|cria|montar|monta|monte|fazer|faz|faca)(?: uma| minha)? playlist(?: (?:de|do|da|para|pra|sobre|com|que|pro))?\s+(.{2,80})$/))) return { kind: "playlist", subject: m[1].trim() };
  if (/\b(?:musica|musicas|som|playlist)\b.*\b(?:clima|tempo de hoje|onde estou|lugar onde estou)\b|^(?:recomende|recomenda|recomendar|sugira|sugere|sugerir)(?: uma| alguma)?(?: musica| som)?$/.test(t)) return { kind: "mood" };
  if ((m = t.match(/^(?:buscar |procurar |achar |me )?(?:mostra |mostrar |ver |diz |dizer )?(?:as |algumas )?musicas? (?:sobre|que falam? (?:de|sobre)|com o tema|por assunto)\s+(.{2,60})$/))) return { kind: "about", subject: m[1].trim() };
  if ((m = t.match(new RegExp(`^(?:por favor )?(?:me )?(?:(?:quero|queria|gostaria de|vou|deixa eu) )?${VERB_PLAY}\\s+${ARTICLE}${THING}(.{2,80}?)(?: no spotify)?$`)))) {
    const q = m[1].trim();
    return VAGUE.test(q) ? { kind: "mood" } : { kind: "play", query: q };
  }
  return null;
}

/** Consultas de busca vindas da IA: só texto curto, sem repetir, no máximo `max`. */
export function cleanQueries(raw: unknown, max = 8): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const q = String(r ?? "").replace(/[\u0000-\u001f"“”]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (q.length >= 2 && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
    if (out.length >= max) break;
  }
  return out;
}
