/**
 * OpenRouter adapter — proxy multi-models (Claude, GPT, Llama, …).
 *
 * Endpoint : POST https://openrouter.ai/api/v1/chat/completions
 * Headers  : Authorization: Bearer <key>, HTTP-Referer (anti-fraud),
 *            X-Title (app identification), content-type
 *
 * OpenRouter expose une API OpenAI-compatible mais demande les headers
 * `HTTP-Referer` et `X-Title` pour identifier l'app source. On envoie
 * "https://prospection.veridian.site" + "Veridian Prospection" — c'est
 * le tenant qui paie la clé, ces headers ne nous engagent à rien.
 *
 * Le `model` est de la forme "provider/model" — ex. "anthropic/claude-3.5-sonnet".
 */
import { AiAdapterError, type AiAdapter, type GenerateOptions, type GenerateResult } from "./adapter";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterAdapter implements AiAdapter {
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
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://prospection.veridian.site",
          "x-title": "Veridian Prospection",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new AiAdapterError(
        "network",
        `OpenRouter network error: ${err instanceof Error ? err.message : String(err)}`,
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
        `OpenRouter ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) {
      throw new AiAdapterError("server", "OpenRouter returned empty content");
    }

    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}
