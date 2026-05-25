/**
 * Anthropic adapter — API Messages.
 *
 * Endpoint : POST https://api.anthropic.com/v1/messages
 * Headers : x-api-key, anthropic-version: 2023-06-01, content-type
 *
 * Caching : on déclare `cache_control: { type: "ephemeral" }` sur le system
 * prompt pour bénéficier du prompt caching (rabais ~90 % sur les tokens
 * répétés cf. doc Anthropic). Le prompt builder garantit que le system
 * prompt est stable (même texte d'instructions à chaque mail) et que le
 * user prompt change (contexte prospect différent à chaque fois).
 */
import { AiAdapterError, type AiAdapter, type GenerateOptions, type GenerateResult } from "./adapter";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicAdapter implements AiAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generateText(
    userPrompt: string,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const system = opts.system
      ? [
          {
            type: "text",
            text: opts.system,
            cache_control: { type: "ephemeral" },
          },
        ]
      : undefined;

    const payload = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
      system,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    };

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new AiAdapterError(
        "network",
        `Anthropic network error: ${err instanceof Error ? err.message : String(err)}`,
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
        `Anthropic ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // L'API Messages retourne content: [{type:"text", text:"..."}]. On
    // concatène tous les blocs text (en pratique il n'y en a qu'un).
    const text = (data.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");

    if (!text) {
      throw new AiAdapterError("server", "Anthropic returned empty content");
    }

    return {
      text,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  }
}
