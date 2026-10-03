// Limites de tamanho de PDF e áudio: fixam o pior caso de custo por operação, com folga larga para o uso normal.

/** Páginas por PDF (MAX_PDF_PAGES). 80 páginas custam cerca de US$ 0,03 para virar nota; uso comum fica abaixo de 20. */
export const maxPdfPages = () => positive(process.env.MAX_PDF_PAGES, 80);
/** Segundos por áudio (MAX_AUDIO_SECONDS). 5 minutos custam cerca de US$ 0,01 para transcrever; um recado comum dura menos de 1. */
export const maxAudioSeconds = () => positive(process.env.MAX_AUDIO_SECONDS, 300);

function positive(raw: string | undefined, fallback: number) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Páginas de um PDF, contando os objetos de página e olhando o total declarado na árvore de páginas (o maior dos dois).
 * É uma leitura rápida, sem abrir o PDF: se não achar nada (PDF com objetos comprimidos), devolve 0 e o limite não barra.
 */
export function pdfPageCount(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const objects = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  let declared = 0;
  for (const m of text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) {
    declared = Math.max(declared, Number(m[1] ?? m[2]));
  }
  return Math.max(objects, declared);
}

/** Duração de um áudio em texto curto: "3 min 20 s". */
export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min${s ? ` ${s} s` : ""}` : `${s} s`;
}
