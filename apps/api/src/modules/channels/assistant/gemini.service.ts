import { Injectable } from "@nestjs/common";
import { geminiTokens, recordUsage } from "./usage";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Monta um WAV (PCM 16-bit mono) a partir do áudio cru devolvido pelo Gemini TTS. */
function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

@Injectable()
export class GeminiService {
  enabled() {
    return !!process.env.GEMINI_API_KEY;
  }

  private async call(model: string, body: object, timeoutMs = 30_000, retries = 2): Promise<any> {
    let lastErr = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Esta chave só é aceita na URL; nunca registrar a URL em logs.
      const res = await fetch(`${BASE}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = await res.json();
        recordUsage("gemini", model, geminiTokens(data));
        return data;
      }
      lastErr = `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`;
      // 503/429: alta demanda, tenta de novo
      if (res.status !== 503 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw new Error(lastErr);
  }

  /** O modelo recebe o áudio diretamente e devolve a transcrição. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    const mime = mimeType.split(";")[0].trim() || "audio/ogg";
    const body = {
      contents: [
        {
          parts: [
            { text: "Transcreva fielmente este áudio em português do Brasil. Devolva apenas o texto falado, sem comentários." },
            { inline_data: { mime_type: mime, data: audio.toString("base64") } },
          ],
        },
      ],
    };
    // Resposta rápida ou nada: se o Gemini demorar, quem chamou usa outro serviço (Whisper).
    const models = [process.env.GEMINI_MODEL || "gemini-3.8-flash", ...(process.env.GEMINI_FALLBACK_MODEL ? [process.env.GEMINI_FALLBACK_MODEL] : [])];
    let lastErr: any;
    for (const model of models) {
      try {
        const data = await this.call(model, body, 15_000, 0);
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
        if (text) return text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("Gemini não devolveu texto");
  }

  /**
   * Lê imagens/PDFs e/ou links junto com o texto e devolve a resposta do modelo (usado para extrair compromissos).
   * Os links são abertos pelo próprio Gemini (ferramenta url_context), não por este servidor.
   */
  async extract(prompt: string, input: { text?: string; urls?: string[]; media?: { mime: string; base64: string }[] }): Promise<string> {
    const parts: any[] = [{ text: prompt }];
    if (input.text) parts.push({ text: `Texto enviado:\n${input.text}` });
    if (input.urls?.length) parts.push({ text: `Links para ler:\n${input.urls.join("\n")}` });
    for (const m of input.media ?? []) parts.push({ inline_data: { mime_type: m.mime.split(";")[0].trim(), data: m.base64 } });
    const body: any = { contents: [{ parts }], ...(input.urls?.length ? { tools: [{ url_context: {} }] } : {}) };
    const models = [process.env.GEMINI_MODEL || "gemini-3.8-flash", ...(process.env.GEMINI_FALLBACK_MODEL ? [process.env.GEMINI_FALLBACK_MODEL] : [])];
    let lastErr: any;
    for (const model of models) {
      try {
        const data = await this.call(model, body, 45_000, 1);
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
        if (text) return text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("Gemini não devolveu texto");
  }

  /** Converte texto em voz (WAV). */
  async speak(text: string): Promise<Buffer> {
    const data = await this.call(process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts", {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_VOICE || "Kore" } } },
      },
    }, 20_000, 1);
    const part = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
    const inline = part?.inlineData ?? part?.inline_data;
    if (!inline?.data) throw new Error("Gemini não devolveu áudio");
    const bytes = Buffer.from(inline.data, "base64");
    const mime: string = (inline.mimeType ?? inline.mime_type ?? "").toLowerCase();
    // Alguns modelos já devolvem WAV; outros, PCM cru de 24 kHz.
    return mime.includes("wav") || bytes.subarray(0, 4).toString() === "RIFF" ? bytes : pcmToWav(bytes);
  }
}
