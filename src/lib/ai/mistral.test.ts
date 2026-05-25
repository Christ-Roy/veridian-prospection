/**
 * Unit tests — MistralAdapter (payload OpenAI-compatible).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MistralAdapter } from "./mistral";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => fetchMock.mockReset());

function okResponse(text = "hi") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }),
    { status: 200 },
  );
}

describe("MistralAdapter", () => {
  it("POST vers api.mistral.ai/v1/chat/completions avec Bearer", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new MistralAdapter("ms-key", "mistral-large-latest").generateText("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer ms-key");
    expect(init.headers.accept).toBe("application/json");
  });

  it("envoie {model, messages, max_tokens, temperature}", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await new MistralAdapter("k", "mistral-small-latest").generateText("hi", {
      system: "s",
      maxTokens: 100,
      temperature: 0.9,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("mistral-small-latest");
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.9);
    expect(body.messages[0]).toEqual({ role: "system", content: "s" });
  });

  it("403 → kind=auth", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const err = await new MistralAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("auth");
  });

  it("503 → kind=server (sabotage-test : différencie auth/server)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const err = await new MistralAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("server");
  });

  it("400 → kind=invalid (sabotage-test : différencie auth/invalid)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad model", { status: 400 }));
    const err = await new MistralAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("invalid");
  });

  it("réponse OK : retourne text + tokensIn/Out depuis usage", async () => {
    // Anti-sabotage : assert sur le retour réel pour détecter `return null`.
    fetchMock.mockResolvedValueOnce(okResponse("réponse mistral"));
    const res = await new MistralAdapter("k", "m").generateText("hi");
    expect(res.text).toBe("réponse mistral");
    expect(res.tokensIn).toBe(4);
    expect(res.tokensOut).toBe(2);
  });
});
