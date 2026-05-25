/**
 * Mistral adapter — Chat Completions (compatible OpenAI).
 *
 * Endpoint : POST https://api.mistral.ai/v1/chat/completions
 * Headers  : Authorization: Bearer <key>, content-type
 *
 * Le payload est OpenAI-compatible (Mistral suit le schéma). On garde un
 * adapter séparé pour 1) loguer "mistral" et 2) pouvoir diverger si un
 * jour Mistral expose des features propriétaires (RAG natif, etc.).
 */
import { AiAdapterError, type AiAdapter, type GenerateOptions, type GenerateResult } from "./adapter";

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

export class MistralAdapter implements AiAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generateText(
    userPrompt: string,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) {
      messages.push({ role: "system", content: opts.system });
    }
    messages.push({ role: "user", content: userPrompt });

    const payload = {
      model: this.model,
      messages,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
    };

    let res: Response;
    try {
      res = await fetch(MISTRAL_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new AiAdapterError(
        "network",
        `Mistral network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const kind =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 429
            ? "rate"
            : res.status >= 500
              ? "server"
              : "invalid";
      throw new AiAdapterError(
        kind,
        `Mistral ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) {
      throw new AiAdapterError("server", "Mistral returned empty content");
    }

    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}
