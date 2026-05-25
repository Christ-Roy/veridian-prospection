/**
 * Tests Nuclear pour src/lib/mail/outbox.ts.
 *
 * Couvre :
 *  - nextRetryDelayMs (timings exponential)
 *  - applySignatureIfEnabled (append HTML + text, no-op si disabled)
 *  - flushOutbox via DI complet (resolveCreds + send + now mockés) — pas
 *    de DB réelle, on injecte un prisma stub minimal qui simule SELECT
 *    FOR UPDATE + UPDATE.
 *
 * Pourquoi pas de Prisma réel : on veut un test fast (< 100ms) sans seed
 * Postgres. La couverture E2E de bout-en-bout vit dans e2e/staging-full/
 * mail-improvements.spec.ts qui prend une DB réelle.
 */
import { describe, it, expect, vi } from "vitest";
import {
  nextRetryDelayMs,
  applySignatureIfEnabled,
  flushOutbox,
  MAIL_OUTBOX_MAX_ATTEMPTS,
  type MailOutboxPayload,
} from "./outbox";
import type { PrismaClient } from "@prisma/client";
import type { SmtpCredentials, SendResult } from "./smtp";

describe("nextRetryDelayMs", () => {
  it("returns 0 for attempts <= 0", () => {
    expect(nextRetryDelayMs(0)).toBe(0);
    expect(nextRetryDelayMs(-1)).toBe(0);
  });

  it("follows exponential schedule 1min/5min/15min/60min/24h", () => {
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(5 * 60_000);
    expect(nextRetryDelayMs(3)).toBe(15 * 60_000);
    expect(nextRetryDelayMs(4)).toBe(60 * 60_000);
    expect(nextRetryDelayMs(5)).toBe(24 * 60 * 60_000);
  });

  it("caps at 24h for attempts > 5", () => {
    expect(nextRetryDelayMs(10)).toBe(24 * 60 * 60_000);
    expect(nextRetryDelayMs(100)).toBe(24 * 60 * 60_000);
  });

  it("MAIL_OUTBOX_MAX_ATTEMPTS is 5 (sanity check)", () => {
    expect(MAIL_OUTBOX_MAX_ATTEMPTS).toBe(5);
  });
});

describe("applySignatureIfEnabled", () => {
  const basePayload: MailOutboxPayload = {
    to: "lead@example.com",
    subject: "Bonjour",
    bodyText: "Bonjour Robert",
    bodyHtml: "<p>Bonjour Robert</p>",
    templateSlug: null,
    siren: null,
    provider: "smtp",
    fromEmail: "me@veridian.site",
    fromName: "Me",
  };

  function makeClient(
    signature: { html: string | null; enabled: boolean } | null,
  ): PrismaClient {
    return {
      tenantMailConfig: {
        findUnique: vi.fn().mockResolvedValue(
          signature
            ? {
                mailSignatureHtml: signature.html,
                mailSignatureEnabled: signature.enabled,
              }
            : null,
        ),
      },
    } as unknown as PrismaClient;
  }

  it("no-op if config row missing", async () => {
    const out = await applySignatureIfEnabled(makeClient(null), "t", basePayload);
    expect(out).toEqual(basePayload);
  });

  it("no-op if signature_enabled is false", async () => {
    const out = await applySignatureIfEnabled(
      makeClient({ html: "<p>Robert</p>", enabled: false }),
      "t",
      basePayload,
    );
    expect(out).toEqual(basePayload);
  });

  it("no-op if signature_html is null or empty", async () => {
    const a = await applySignatureIfEnabled(
      makeClient({ html: null, enabled: true }),
      "t",
      basePayload,
    );
    expect(a).toEqual(basePayload);

    const b = await applySignatureIfEnabled(
      makeClient({ html: "   ", enabled: true }),
      "t",
      basePayload,
    );
    expect(b).toEqual(basePayload);
  });

  it("appends signature HTML wrapped in marker div", async () => {
    const out = await applySignatureIfEnabled(
      makeClient({ html: "<p>--<br>Robert Brunon</p>", enabled: true }),
      "t",
      basePayload,
    );
    expect(out.bodyHtml).toContain('class="veridian-mail-signature"');
    expect(out.bodyHtml).toContain("<p>--<br>Robert Brunon</p>");
    expect(out.bodyHtml.startsWith("<p>Bonjour Robert</p>")).toBe(true);
  });

  it("appends signature text (HTML stripped) with -- separator", async () => {
    const out = await applySignatureIfEnabled(
      makeClient({ html: "<p>Robert Brunon</p><p>+33 6 12</p>", enabled: true }),
      "t",
      basePayload,
    );
    expect(out.bodyText).toContain("\n\n--\n");
    expect(out.bodyText).toContain("Robert Brunon");
    expect(out.bodyText).toContain("+33 6 12");
    expect(out.bodyText).not.toContain("<p>");
  });

  it("does not mutate the input payload", async () => {
    const snapshot = { ...basePayload };
    await applySignatureIfEnabled(
      makeClient({ html: "<p>sig</p>", enabled: true }),
      "t",
      basePayload,
    );
    expect(basePayload).toEqual(snapshot);
  });
});

describe("flushOutbox", () => {
  const sampleCreds: SmtpCredentials = {
    host: "smtp.test",
    port: 587,
    username: "u",
    passwordEnc: "iv:tag:ct",
    tls: true,
    fromEmail: "from@test.com",
    fromName: "Test",
  };
  const samplePayload: MailOutboxPayload = {
    to: "to@test.com",
    subject: "S",
    bodyText: "T",
    bodyHtml: "<p>T</p>",
    templateSlug: null,
    siren: null,
    provider: "smtp",
    fromEmail: "from@test.com",
    fromName: "Test",
  };

  /** Build a prisma stub with a single queued row in mail_outbox. */
  function makePrisma(
    rows: Array<{ id: string; tenant_id: string; payload: MailOutboxPayload; attempts: number }>,
  ): {
    client: PrismaClient;
    updates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
    leadUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  } {
    const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
    const leadUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
    let pickedOnce = false;

    const client = {
      $transaction: async <T,>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> => {
        // Simule la tx en passant le même client (le test n'a pas besoin
        // de l'isolation tx réelle puisqu'on stube tout).
        return fn(client as unknown as PrismaClient);
      },
      $queryRawUnsafe: async () => {
        if (pickedOnce) return [];
        pickedOnce = true;
        return rows.map((r) => ({
          id: r.id,
          tenant_id: r.tenant_id,
          lead_email_id: `lead-${r.id}`,
          payload: r.payload,
          attempts: r.attempts,
        }));
      },
      mailOutbox: {
        updateMany: vi.fn().mockResolvedValue({ count: rows.length }),
        update: vi.fn().mockImplementation((args: Parameters<PrismaClient["mailOutbox"]["update"]>[0]) => {
          updates.push(args as { where: { id: string }; data: Record<string, unknown> });
          return Promise.resolve({});
        }),
      },
      leadEmail: {
        update: vi.fn().mockImplementation((args: Parameters<PrismaClient["leadEmail"]["update"]>[0]) => {
          leadUpdates.push(args as { where: { id: string }; data: Record<string, unknown> });
          return Promise.resolve({});
        }),
      },
      tenantMailConfig: {
        findUnique: vi.fn().mockResolvedValue({
          mailSignatureHtml: null,
          mailSignatureEnabled: true,
        }),
      },
    } as unknown as PrismaClient;
    return { client, updates, leadUpdates };
  }

  it("returns picked=0 when queue empty", async () => {
    const { client } = makePrisma([]);
    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => sampleCreds,
      send: async () => ({ ok: true, messageId: "<m@x>" }),
    });
    expect(result).toEqual({ picked: 0, sent: 0, failedRetry: 0, failed: 0 });
  });

  it("sends a queued row and marks sent + bumps lead_emails", async () => {
    const { client, updates, leadUpdates } = makePrisma([
      { id: "out-1", tenant_id: "t1", payload: samplePayload, attempts: 0 },
    ]);
    const sendSpy = vi.fn().mockResolvedValue({ ok: true, messageId: "<msg@x>" } as SendResult);

    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => sampleCreds,
      send: sendSpy,
    });

    expect(result).toEqual({ picked: 1, sent: 1, failedRetry: 0, failed: 0 });
    expect(sendSpy).toHaveBeenCalledOnce();
    // 1 update final 'sent' (le 'sending' transitoire passe par updateMany).
    expect(updates.some((u) => u.data.status === "sent")).toBe(true);
    expect(leadUpdates.some((u) => u.data.sentStatus === "sent" && u.data.messageId === "<msg@x>")).toBe(
      true,
    );
  });

  it("on transient SMTP fail: status=failed_retry + nextRetryAt in future", async () => {
    const { client, updates } = makePrisma([
      { id: "out-2", tenant_id: "t1", payload: samplePayload, attempts: 0 },
    ]);
    const now = new Date("2026-01-01T00:00:00Z");

    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => sampleCreds,
      send: async () => ({ ok: false, reason: "timeout", errorMessage: "ETIMEDOUT" }),
      now: () => now,
    });

    expect(result).toEqual({ picked: 1, sent: 0, failedRetry: 1, failed: 0 });
    const update = updates.find((u) => u.data.status === "failed_retry");
    expect(update).toBeDefined();
    expect(update!.data.attempts).toBe(1);
    expect(update!.data.lastError).toBe("ETIMEDOUT");
    // nextRetryAt = now + 1min (attempts=1).
    const nextRetry = update!.data.nextRetryAt as Date;
    expect(nextRetry.getTime() - now.getTime()).toBe(60_000);
  });

  it("at MAX_ATTEMPTS - 1 fail: still failed_retry", async () => {
    const { client, updates } = makePrisma([
      { id: "out-3", tenant_id: "t1", payload: samplePayload, attempts: MAIL_OUTBOX_MAX_ATTEMPTS - 2 },
    ]);
    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => sampleCreds,
      send: async () => ({ ok: false, reason: "rejected", errorMessage: "550" }),
    });
    expect(result.failedRetry).toBe(1);
    expect(result.failed).toBe(0);
    expect(updates.some((u) => u.data.status === "failed_retry")).toBe(true);
  });

  it("at MAX_ATTEMPTS fail: row is marked 'failed' + lead_emails=failed", async () => {
    const { client, updates, leadUpdates } = makePrisma([
      { id: "out-4", tenant_id: "t1", payload: samplePayload, attempts: MAIL_OUTBOX_MAX_ATTEMPTS - 1 },
    ]);
    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => sampleCreds,
      send: async () => ({ ok: false, reason: "auth_failed", errorMessage: "535" }),
    });
    expect(result.failed).toBe(1);
    expect(result.failedRetry).toBe(0);
    const failedUpdate = updates.find((u) => u.data.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate!.data.attempts).toBe(MAIL_OUTBOX_MAX_ATTEMPTS);
    expect(leadUpdates.some((u) => u.data.sentStatus === "failed")).toBe(true);
  });

  it("resolveCreds=null → row failed immediately (no retry possible)", async () => {
    const { client, updates, leadUpdates } = makePrisma([
      { id: "out-5", tenant_id: "t1", payload: samplePayload, attempts: 0 },
    ]);
    const sendSpy = vi.fn();
    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => null,
      send: sendSpy,
    });
    expect(result.failed).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(updates.some((u) => u.data.lastError === "missing_credentials")).toBe(true);
    expect(leadUpdates.some((u) => u.data.sentError === "missing_credentials")).toBe(true);
  });

  it("corrupted payload → row failed, no send attempt", async () => {
    const corruptedRows = [
      // Cast intentionnel — on simule un payload corrompu (sans `to` requis).
      { id: "out-6", tenant_id: "t1", payload: { broken: true } as unknown as MailOutboxPayload, attempts: 0 },
    ];
    const { client, updates } = makePrisma(corruptedRows);
    const sendSpy = vi.fn();
    const result = await flushOutbox({
      prisma: client,
      resolveCreds: async () => sampleCreds,
      send: sendSpy,
    });
    expect(result.failed).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(updates.some((u) => u.data.lastError === "payload_corrupted")).toBe(true);
  });
});
