/**
 * Unit tests pour le client Notifuse Prospection.
 *
 * fetch stubé en mémoire — aucun appel réseau.
 * Run : npx vitest run src/lib/notifuse/client.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { sendInvitationEmail } from "./client";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NOTIFUSE_URL: "https://notifuse.test.local" };
  vi.useRealTimers();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

const BASE_INPUT = {
  workspaceId: "ws-1",
  apiKey: "jwt.fake.token",
  toEmail: "newbie@example.com",
  externalId: "invitation-deadbeef",
  vars: {
    inviter_email: "boss@example.com",
    workspace_name: "Acme",
    invite_url: "https://app.test/invite/abc",
    expires_at: "2026-05-30T00:00:00.000Z",
  },
} as const;

describe("sendInvitationEmail", () => {
  it("POST /api/transactional.send avec Bearer + body Notifuse correct", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ message_id: "msg-123", success: true }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({ ok: true, messageId: "msg-123", status: 200 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://notifuse.test.local/api/transactional.send");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt.fake.token");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      workspace_id: "ws-1",
      notification: {
        id: "invitation-prospection",
        external_id: "invitation-deadbeef",
        contact: { email: "newbie@example.com" },
        data: {
          inviter_email: "boss@example.com",
          workspace_name: "Acme",
          invite_url: "https://app.test/invite/abc",
          expires_at: "2026-05-30T00:00:00.000Z",
        },
      },
    });
  });

  it("strip trailing slash dans NOTIFUSE_URL", async () => {
    process.env.NOTIFUSE_URL = "https://notifuse.test.local////";
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await sendInvitationEmail({ ...BASE_INPUT });

    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://notifuse.test.local/api/transactional.send",
    );
  });

  it("ok=false reason=missing_url si NOTIFUSE_URL absent", async () => {
    delete process.env.NOTIFUSE_URL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({ ok: false, reason: "missing_url" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ok=false reason=missing_credentials si apiKey vide", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendInvitationEmail({ ...BASE_INPUT, apiKey: "" });

    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ok=false reason=missing_workspace si workspaceId vide", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendInvitationEmail({ ...BASE_INPUT, workspaceId: "" });

    expect(result).toEqual({ ok: false, reason: "missing_workspace" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ok=false reason=auth_failed sur 401/403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({ ok: false, reason: "auth_failed", status: 401 });
  });

  it("ok=false reason=missing_template sur 400 'not found'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":"notification not found"}', { status: 400 }),
      ),
    );

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({
      ok: false,
      reason: "missing_template",
      status: 400,
    });
  });

  it("ok=false reason=missing_template sur 400 'not active'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":"notification not active"}', { status: 400 }),
      ),
    );

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result.reason).toBe("missing_template");
  });

  it("ok=false reason=http_error sur 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({ ok: false, reason: "http_error", status: 500 });
  });

  it("ok=false reason=network_error si fetch throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({ ok: false, reason: "network_error" });
  });

  it("ok=false reason=timeout si fetch est aborté", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );

    const result = await sendInvitationEmail({ ...BASE_INPUT });

    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
