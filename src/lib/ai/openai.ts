/**
 * OpenAI adapter — Chat Completions API.
 *
 * Endpoint : POST https://api.openai.com/v1/chat/completions
 * Headers  : Authorization: Bearer <key>, content-type
 *
 * On reste sur Chat Completions (et pas Responses API) parce qu'il est
 * supporté universellement par les proxies OpenAI-compatibles (LiteLLM,
 * Azure OpenAI, etc.) si jamais un client veut router via un proxy.
 */
import { AiAdapterError, type AiAdapter, type GenerateOptions, type GenerateResult } from "./adapter";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAiAdapter implements AiAdapter {
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

    // o1 (reasoning models) refuse `temperature` et utilise `max_completion_tokens`.
    const isReasoning = this.model.startsWith("o1") || this.model.startsWith("o3");

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (isReasoning) {
      payload.max_completion_tokens = opts.maxTokens ?? 2000;
    } else {
      payload.max_tokens = opts.maxTokens ?? 2000;
      payload.temperature = opts.temperature ?? 0.7;
    }

    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new AiAdapterError(
        "network",
        `OpenAI network error: ${err instanceof Error ? err.message : String(err)}`,
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
        `OpenAI ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) {
      throw new AiAdapterError("server", "OpenAI returned empty content");
    }

    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}
