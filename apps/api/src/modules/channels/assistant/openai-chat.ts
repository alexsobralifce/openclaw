// Chamadas de chat ao OpenAI num lugar só: modelo principal, modelo reserva, limite de tempo, cota e contagem de tokens.

import { Logger } from "@nestjs/common";
import { assertQuota, openaiTokens, recordUsage } from "./usage";

const logger = new Logger("OpenAI");
const URL = "https://api.openai.com/v1/chat/completions";

export const primaryModel = () => process.env.OPENAI_MODEL || "gpt-4o-mini";
/** Modelo que assume quando o principal falha (OPENAI_FALLBACK_MODEL); vazio = sem reserva. */
export const fallbackModel = () => (process.env.OPENAI_FALLBACK_MODEL || "").trim();

/**
 * Esforço de raciocínio enviado só ao modelo reserva (OPENAI_FALLBACK_REASONING, padrão "none"). Modelos de raciocínio como o
 * gpt-6-luna recusam ferramentas no chat quando têm raciocínio ligado (erro 400), e "none" também evita gastar tokens
 * pensando. O modelo principal (gpt-4o-mini) não aceita o parâmetro, por isso ele nunca o recebe. "off" não envia nada.
 */
export const fallbackReasoning = () => {
  const v = (process.env.OPENAI_FALLBACK_REASONING ?? "none").trim().toLowerCase();
  return v && v !== "off" ? v : "";
};

/**
 * Vale tentar o reserva? Sim para falha de rede ou de tempo, limite de uso (429), modelo fora do ar (5xx) ou que
 * deixou de existir (404). Não para 400, 401 e 403: o erro é do pedido ou da chave e o reserva falharia igual.
 */
export const shouldFallback = (status: number | null) => status === null || status === 404 || status === 408 || status === 429 || status >= 500;

/** Chama o chat com o modelo principal; se ele falhar por um motivo que o reserva pode resolver, tenta o reserva. */
export async function chatCompletion(body: Record<string, unknown>, opts: { apiKey: string; ws?: string; timeoutMs?: number }): Promise<any> {
  await assertQuota();
  const fb = fallbackModel();
  const models = [primaryModel(), ...(fb && fb !== primaryModel() ? [fb] : [])];
  let lastErr = new Error("OpenAI indisponível");
  for (let k = 0; k < models.length; k++) {
    let status: number | null = null;
    let payload: Record<string, unknown> = k > 0 && fallbackReasoning() ? { ...body, reasoning_effort: fallbackReasoning() } : body;
    for (let again = 0; again < 2; again++) {
      try {
        const res = await fetch(URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ model: models[k], ...payload }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
        });
        if (res.ok) {
          const data: any = await res.json();
          recordUsage("openai", String(data.model ?? models[k]), openaiTokens(data), opts.ws);
          return data;
        }
        status = res.status;
        const text = (await res.text()).slice(0, 300);
        lastErr = new Error(`OpenAI ${res.status}: ${text}`);
        // O reserva não aceita o parâmetro de raciocínio: repete o mesmo pedido sem ele
        if (res.status === 400 && "reasoning_effort" in payload && /reasoning_effort/i.test(text) && !/Function tools/i.test(text)) {
          const { reasoning_effort: _drop, ...rest } = payload;
          payload = rest;
          continue;
        }
      } catch (e: any) {
        lastErr = new Error(`OpenAI indisponível: ${e?.message ?? e}`);
      }
      break;
    }
    if (k < models.length - 1 && shouldFallback(status)) logger.warn(`Modelo ${models[k]} falhou (${lastErr.message.slice(0, 120)}); usando o reserva ${models[k + 1]}`);
    else break;
  }
  throw lastErr;
}
