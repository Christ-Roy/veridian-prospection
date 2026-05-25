/**
 * Unit tests — OpenAiAdapter.
 *
 * Asserte le shape Chat Completions + branche reasoning (o1/o3 utilise
 * max_completion_tokens et refuse temperature).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenAiAdapter } from "./openai";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => fetchMock.mockReset());

function okResponse(text = "hi", usage = { prompt_tokens: 3, completion_tokens: 2 }) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }], usage }),
    { status: 200 },
  );
}

describe("OpenAiAdapter — payload Chat Completions", () => {
  it("POST avec Authorization Bearer + content-type", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new OpenAiAdapter("sk-test", "gpt-4o-mini").generateText("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("ajoute le system message en tête si fourni", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new OpenAiAdapter("k", "gpt-4o").generateText("hi", { system: "rules" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "hi" },
    ]);
  });

  it("modèle non-reasoning : utilise max_tokens + temperature", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new OpenAiAdapter("k", "gpt-4o").generateText("hi", {
      maxTokens: 500,
      temperature: 0.3,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("modèle reasoning (o1) : utilise max_completion_tokens, pas temperature", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new OpenAiAdapter("k", "o1").generateText("hi", {
      maxTokens: 999,
      temperature: 0.5,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(999);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
});

describe("OpenAiAdapter — réponse et erreurs", () => {
  it("retourne text + tokensIn/Out", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("salut", { prompt_tokens: 7, completion_tokens: 3 }));
    const res = await new OpenAiAdapter("k", "gpt-4o").generateText("hi");
    expect(res.text).toBe("salut");
    expect(res.tokensIn).toBe(7);
    expect(res.tokensOut).toBe(3);
  });

  it("401 → kind=auth", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid", { status: 401 }));
    const err = await new OpenAiAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("auth");
  });

  it("429 → kind=rate", async () => {
    fetchMock.mockResolvedValueOnce(new Response("limit", { status: 429 }));
    const err = await new OpenAiAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("rate");
  });
});
