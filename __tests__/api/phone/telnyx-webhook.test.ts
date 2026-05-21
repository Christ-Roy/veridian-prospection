/**
 * Tests de POST /api/phone/telnyx-webhook.
 *
 * Sécurité (T20 2026-05-21) : signature Ed25519 obligatoire. On génère une
 * paire Ed25519 dans `vi.hoisted()` et on injecte la clé publique en ENV
 * avant l'import de la route — cf [[project_route_safe_parse_pattern]] et
 * `_helpers.ts` pour le pattern de capture env au module-load.
 *
 * 2026-05-20 : ajout d'invariants sur le mapping status ↔ pipeline_stage
 * pour les 3 events webhook (answered, hangup, machine.detection).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { sign as cryptoSign, type KeyObject } from "crypto";
import { pipelineStageForStatus } from "@/lib/outreach/status";

const { prismaMock, handleIncomingCallMock, keypair } = vi.hoisted(() => {
  // Génère une keypair Ed25519 pour signer les payloads de test. Import
  // dynamique via require() requis car vi.hoisted s'exécute avant les imports ESM.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateKeyPairSync } = require("crypto") as typeof import("crypto");
  const kp = generateKeyPairSync("ed25519");
  // Export la clé publique au format SPKI DER, puis on retire le préfixe
  // 12-octets pour récupérer les 32 octets de clé brute (format Telnyx).
  const der = kp.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const rawPub = der.subarray(12);
  process.env.TELNYX_PUBLIC_KEY = rawPub.toString("base64");

  return {
    prismaMock: {
      callLog: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
      $executeRaw: vi.fn(),
      $executeRawUnsafe: vi.fn(),
    },
    handleIncomingCallMock: vi.fn(),
    keypair: { privateKey: kp.privateKey as KeyObject, publicKey: kp.publicKey as KeyObject },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/app/api/phone/telnyx-webhook/incoming-handler", () => ({
  handleIncomingCall: handleIncomingCallMock,
}));

import { POST } from "@/app/api/phone/telnyx-webhook/route";
import { makeRequest, readJson } from "../_helpers";

/** Signe un payload avec la clé privée de test et construit la NextRequest. */
function makeSignedRequest(
  body: unknown,
  opts: {
    timestampOverride?: string;
    signatureOverride?: string;
    skipSignature?: boolean;
    skipTimestamp?: boolean;
    mutateBody?: string;
  } = {},
) {
  const rawBody =
    typeof body === "string" ? body : JSON.stringify(body);
  const ts = opts.timestampOverride ?? String(Math.floor(Date.now() / 1000));
  const message = Buffer.from(`${ts}|${opts.mutateBody ?? rawBody}`, "utf8");
  const sigB64 = cryptoSign(null, message, keypair.privateKey).toString(
    "base64",
  );

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.skipSignature) {
    headers["telnyx-signature-ed25519"] = opts.signatureOverride ?? sigB64;
  }
  if (!opts.skipTimestamp) {
    headers["telnyx-timestamp"] = ts;
  }

  return makeRequest("/api/phone/telnyx-webhook", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/phone/telnyx-webhook — invariants sync status ↔ pipeline_stage", () => {
  test("call.answered : status='appele' → pipeline_stage='repondeur'", () => {
    expect(pipelineStageForStatus("appele")).toBe("repondeur");
  });

  test("call.hangup (court): status='rappeler' → pipeline_stage='a_rappeler'", () => {
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
  });

  test("call.machine.detection: status='rappeler' → pipeline_stage='a_rappeler'", () => {
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
  });
});

describe("POST /api/phone/telnyx-webhook — auth Ed25519", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 quand le header signature est absent (PoC pentest T16)", async () => {
    const res = await POST(
      makeSignedRequest(
        {
          data: {
            event_type: "call.initiated",
            payload: { call_control_id: "ATTACKER", direction: "incoming", from: "+33999000000" },
          },
        },
        { skipSignature: true },
      ),
    );
    expect(res.status).toBe(401);
    expect(handleIncomingCallMock).not.toHaveBeenCalled();
  });

  test("401 quand le header timestamp est absent", async () => {
    const res = await POST(
      makeSignedRequest({ data: {} }, { skipTimestamp: true }),
    );
    expect(res.status).toBe(401);
  });

  test("401 quand la signature est invalide", async () => {
    const res = await POST(
      makeSignedRequest({ data: {} }, { signatureOverride: "AAAA" + "B".repeat(84) }),
    );
    expect(res.status).toBe(401);
  });

  test("401 quand le body est muté après signature (anti-tamper)", async () => {
    const res = await POST(
      makeSignedRequest({ data: { evil: false } }, { mutateBody: '{"data":{"evil":true}}' }),
    );
    expect(res.status).toBe(401);
  });

  test("401 quand timestamp drift > 5min (anti-replay)", async () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 600);
    const res = await POST(makeSignedRequest({ data: {} }, { timestampOverride: oldTs }));
    expect(res.status).toBe(401);
  });

  test("500 quand TELNYX_PUBLIC_KEY est absent (fail-closed)", async () => {
    const previous = process.env.TELNYX_PUBLIC_KEY;
    delete process.env.TELNYX_PUBLIC_KEY;
    try {
      const res = await POST(makeSignedRequest({ data: {} }));
      expect(res.status).toBe(500);
    } finally {
      process.env.TELNYX_PUBLIC_KEY = previous;
    }
  });
});

describe("POST /api/phone/telnyx-webhook — happy path (signature valide)", () => {
  beforeEach(() => vi.clearAllMocks());

  test("200 sur payload vide signé", async () => {
    const res = await POST(makeSignedRequest({}));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("200 sur event sans call_control_id", async () => {
    const res = await POST(
      makeSignedRequest({ data: { event_type: "call.initiated", payload: {} } }),
    );
    expect(res.status).toBe(200);
  });

  test("dispatche le handler incoming sur call.initiated/incoming", async () => {
    prismaMock.callLog.findFirst.mockResolvedValue(null);
    const res = await POST(
      makeSignedRequest({
        data: {
          event_type: "call.initiated",
          payload: {
            call_control_id: "cc-1",
            direction: "incoming",
            from: "+33612345678",
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(handleIncomingCallMock).toHaveBeenCalledWith("cc-1", "+33612345678");
  });
});
