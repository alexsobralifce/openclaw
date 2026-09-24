import { Injectable } from "@nestjs/common";

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

  private async call(model: string, body: object): Promise<any> {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY as string },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 250)}`);
    return res.json();
  }

  /** O modelo recebe o áudio diretamente e devolve a transcrição. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    const mime = mimeType.split(";")[0].trim() || "audio/ogg";
    const data = await this.call(process.env.GEMINI_MODEL || "gemini-2.5-flash", {
      contents: [
        {
          parts: [
            { text: "Transcreva fielmente este áudio em português do Brasil. Devolva apenas o texto falado, sem comentários." },
            { inline_data: { mime_type: mime, data: audio.toString("base64") } },
          ],
        },
      ],
    });
    return (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  }

  /** Converte texto em voz (WAV). */
  async speak(text: string): Promise<Buffer> {
    const data = await this.call(process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts", {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_VOICE || "Kore" } } },
      },
    });
    const b64 = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
    const raw = b64?.inlineData?.data ?? b64?.inline_data?.data;
    if (!raw) throw new Error("Gemini não devolveu áudio");
    return pcmToWav(Buffer.from(raw, "base64"));
  }
}
