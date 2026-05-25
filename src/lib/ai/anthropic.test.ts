/**
 * Unit tests — AnthropicAdapter.
 *
 * Mock global.fetch et asserte :
 *   - Le payload envoyé matche le schéma Messages API (model, max_tokens,
 *     temperature, messages, system avec cache_control)
 *   - Headers : x-api-key, anthropic-version, content-type
 *   - Parsing des champs usage (input_tokens / output_tokens)
 *   - Mapping erreur HTTP → AiAdapterError.kind (auth/rate/server/invalid)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic";
import { AiAdapterError } from "./adapter";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("AnthropicAdapter — payload shape", () => {
  it("envoie un POST avec headers x-api-key, anthropic-version, content-type", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "OK" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    const adapter = new AnthropicAdapter("sk-ant-xxx", "claude-opus-4-7");
    await adapter.generateText("Hello", { system: "You are helpful" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-ant-xxx");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("inclut cache_control sur le system prompt (prompt caching)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "{}" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    const adapter = new AnthropicAdapter("k", "claude-haiku-4-5");
    await adapter.generateText("u", { system: "stable system" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toEqual([
      {
        type: "text",
        text: "stable system",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("encode model, max_tokens et temperature dans le payload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    const adapter = new AnthropicAdapter("k", "claude-sonnet-4-6");
    await adapter.generateText("hi", { maxTokens: 1234, temperature: 0.2 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(1234);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("AnthropicAdapter — réponse et erreurs", () => {
  it("retourne text + tokensIn/Out depuis content[0].text et usage", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hello world" }],
          usage: { input_tokens: 42, output_tokens: 11 },
        }),
        { status: 200 },
      ),
    );
    const res = await new AnthropicAdapter("k", "m").generateText("hi");
    expect(res.text).toBe("hello world");
    expect(res.tokensIn).toBe(42);
    expect(res.tokensOut).toBe(11);
  });

  it("401 → AiAdapterError kind=auth", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid api key", { status: 401 }));
    await expect(new AnthropicAdapter("bad", "m").generateText("hi")).rejects.toMatchObject({
      name: "AiAdapterError",
      kind: "auth",
    });
  });

  it("429 → AiAdapterError kind=rate", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    const err = await new AnthropicAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err).toBeInstanceOf(AiAdapterError);
    expect(err.kind).toBe("rate");
  });

  it("500 → AiAdapterError kind=server", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 503 }));
    const err = await new AnthropicAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("server");
  });

  it("400 → AiAdapterError kind=invalid", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad model", { status: 400 }));
    const err = await new AnthropicAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("invalid");
  });

  it("réseau fail → AiAdapterError kind=network", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const err = await new AnthropicAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("network");
  });

  it("réponse vide → AiAdapterError kind=server", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 }),
    );
    const err = await new AnthropicAdapter("k", "m").generateText("hi").catch((e) => e);
    expect(err.kind).toBe("server");
  });
});
