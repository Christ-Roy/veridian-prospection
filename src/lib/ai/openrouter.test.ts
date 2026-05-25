/**
 * Unit tests — OpenRouterAdapter (proxy multi-models).
 *
 * Spécifique : headers HTTP-Referer + X-Title obligatoires côté OpenRouter
 * pour identifier l'app source.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenRouterAdapter } from "./openrouter";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => fetchMock.mockReset());

function okResponse() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200 },
  );
}

describe("OpenRouterAdapter", () => {
  it("envoie HTTP-Referer + X-Title (anti-fraud OpenRouter)", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new OpenRouterAdapter("or-key", "anthropic/claude-3.5-sonnet").generateText("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers["http-referer"]).toBe("https://prospection.veridian.site");
    expect(init.headers["x-title"]).toBe("Veridian Prospection");
    expect(init.headers.authorization).toBe("Bearer or-key");
  });

  it("passe le model 'provider/model' tel quel", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new OpenRouterAdapter("k", "meta-llama/llama-3.3-70b-instruct").generateText("hi");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("meta-llama/llama-3.3-70b-instruct");
  });

  it("503 → kind=server", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const err = await new OpenRouterAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("server");
  });
});
