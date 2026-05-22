/**
 * Tests POST /api/tenants/update-plan — conformité CONTRAT-BILLING.md v2 §3.
 *
 * Couvre les 6 invariants v2 :
 *  1. Versioning — 400 si `contract_version` absent / major ≠ 2.
 *  2. Enum `plan` fermé — `free|pro|business|enterprise`, 400 hors enum.
 *     Mapping `free→freemium`, `enterprise→business` (+ pas de 400).
 *  3. Enum `plan_source` v2 — `stripe|stripe_trial|grant_manual|downgrade_auto`.
 *  4. Idempotence — replay du même `idempotency_key` = 200 no-op.
 *  5. Plan offert immune — `grant_manual` / legacy `lifetime_*` pas downgradé
 *     par un signal Stripe ; `grant_manual` entrant peut tout écraser.
 *  6. (Fail-open — couvert par l'absence de cron downgrade, hors handler.)
 *
 * Plus : auth HMAC, champs requis, persistance du nom LOCAL en DB.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-update-plan-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique, update: mocks.tenantUpdate },
  },
}));

import { POST } from "@/app/api/tenants/update-plan/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-update-plan-secret";

/** Payload v2 valide par défaut — chaque test override ce qu'il teste. */
function v2Body(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "2.0",
    tenant_id: "t-1",
    plan: "pro",
    plan_source: "stripe",
    effective_at: new Date().toISOString(),
    stripe_subscription_id: "sub_test",
    idempotency_key: randomUUID(),
    reason: "test",
    ...overrides,
  };
}

function signed(body: object) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return {
    raw,
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
  };
}

function req(raw: string, headers: Record<string, string>) {
  return makeRequest("/api/tenants/update-plan", {
    method: "POST",
    headers,
    body: raw,
  });
}

/** Appel signé d'un payload object → NextResponse. */
async function call(body: object) {
  const { raw, headers } = signed(body);
  return POST(req(raw, headers));
}

/** Construit l'erreur P2002 de Prisma (collision unique idempotency_key). */
function p2002() {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`idempotency_key`)",
    { code: "P2002", clientVersion: "test" },
  );
}

describe("POST /api/tenants/update-plan — CONTRAT-BILLING v2", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Auth ───────────────────────────────────────────────────────────────
  test("401 si HMAC absent", async () => {
    const r = makeRequest("/api/tenants/update-plan", {
      method: "POST",
      body: v2Body(),
    });
    expect((await POST(r)).status).toBe(401);
  });

  // ── Invariant 1 — versioning §3.4.1 ────────────────────────────────────
  test("400 si contract_version absent", async () => {
    const body = v2Body();
    delete (body as Record<string, unknown>).contract_version;
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(((await readJson(res)) as { error: string }).error).toBe(
      "invalid_payload",
    );
  });

  test("400 si contract_version major inconnu (3.x)", async () => {
    const res = await call(v2Body({ contract_version: "3.0" }));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as {
      error: string;
      details: { supported_major: number };
    };
    expect(body.error).toBe("invalid_payload");
    expect(body.details.supported_major).toBe(2);
  });

  test("200 si contract_version minor supérieur (2.1) — compat 2.x", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(v2Body({ contract_version: "2.1" }));
    expect(res.status).toBe(200);
  });

  // ── Champs requis ──────────────────────────────────────────────────────
  test("400 si tenant_id manquant", async () => {
    const body = v2Body();
    delete (body as Record<string, unknown>).tenant_id;
    expect((await call(body)).status).toBe(400);
  });

  test("400 si plan manquant", async () => {
    const body = v2Body();
    delete (body as Record<string, unknown>).plan;
    expect((await call(body)).status).toBe(400);
  });

  test("400 si idempotency_key manquant", async () => {
    const body = v2Body();
    delete (body as Record<string, unknown>).idempotency_key;
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(((await readJson(res)) as { error: string }).error).toBe(
      "invalid_payload",
    );
  });

  // ── Invariant 2 — enum plan fermé §3.4.2 ───────────────────────────────
  test("400 si plan hors enum canonique — retourne allowed_plans v2", async () => {
    const res = await call(v2Body({ plan: "ultra-mega" }));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as {
      error: string;
      details: { allowed_plans: string[] };
    };
    expect(body.error).toBe("invalid_plan");
    expect(body.details.allowed_plans).toEqual([
      "free",
      "pro",
      "business",
      "enterprise",
    ]);
  });

  test("400 si plan = freemium (nom LOCAL, pas l'enum canonique du fil)", async () => {
    // `freemium` est le nom local Prospection — il ne franchit jamais l'API.
    const res = await call(v2Body({ plan: "freemium" }));
    expect(res.status).toBe(400);
    expect(((await readJson(res)) as { error: string }).error).toBe(
      "invalid_plan",
    );
  });

  test("plan=free est persisté en DB comme 'freemium' (mapping §3.2bis)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "pro",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(
      v2Body({ plan: "free", plan_source: "downgrade_auto" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    expect(body.plan).toBe("freemium");

    const call0 = mocks.tenantUpdate.mock.calls[0][0];
    expect(call0.data.plan).toBe("freemium");
    expect(call0.data.planHistory.create.plan).toBe("freemium");
  });

  test("plan=enterprise traité comme 'business' sans 400 (§3.2bis)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "pro",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(v2Body({ plan: "enterprise" }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    // Prospection n'a pas de tier Enterprise → plafonne à business.
    expect(body.plan).toBe("business");
    expect(mocks.tenantUpdate.mock.calls[0][0].data.plan).toBe("business");
  });

  test("plan=business est persisté tel quel", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "pro",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(v2Body({ plan: "business" }));
    expect(res.status).toBe(200);
    expect(mocks.tenantUpdate.mock.calls[0][0].data.plan).toBe("business");
  });

  // ── Invariant 3 — enum plan_source v2 §3.3 ─────────────────────────────
  test("400 si plan_source hors enum v2", async () => {
    const res = await call(v2Body({ plan_source: "smoke" }));
    expect(res.status).toBe(400);
  });

  test("400 si plan_source = 'manual' (valeur v1 supprimée en v2)", async () => {
    const res = await call(v2Body({ plan_source: "manual" }));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as {
      details: { allowed_sources: string[] };
    };
    expect(body.details.allowed_sources).toEqual([
      "stripe",
      "stripe_trial",
      "grant_manual",
      "downgrade_auto",
    ]);
  });

  test("plan_source=stripe_trial accepté et persisté distinct de stripe (§7.2)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(
      v2Body({ plan: "pro", plan_source: "stripe_trial" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan_source: string };
    expect(body.plan_source).toBe("stripe_trial");
    expect(mocks.tenantUpdate.mock.calls[0][0].data.planSource).toBe(
      "stripe_trial",
    );
  });

  test("plan_source=downgrade_auto accepté", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "pro",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(
      v2Body({ plan: "free", plan_source: "downgrade_auto" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.tenantUpdate.mock.calls[0][0].data.planSource).toBe(
      "downgrade_auto",
    );
  });

  // ── Invariant 4 — idempotence §3.4.3 ───────────────────────────────────
  test("404 si tenant introuvable", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    expect((await call(v2Body({ tenant_id: "t-x" }))).status).toBe(404);
  });

  test("replay du même idempotency_key → 200 no-op (collision P2002)", async () => {
    mocks.tenantFindUnique
      // 1er findUnique : le tenant (avant update)
      .mockResolvedValueOnce({ id: "t-1", plan: "pro", planSource: "stripe" })
      // 2e findUnique : relecture de l'état après collision
      .mockResolvedValueOnce({ plan: "business", planSource: "stripe" });
    mocks.tenantUpdate.mockRejectedValueOnce(p2002());

    const res = await call(
      v2Body({ plan: "business", idempotency_key: "dup-key-1" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      idempotent_replay: boolean;
      plan: string;
    };
    expect(body.idempotent_replay).toBe(true);
    // L'état renvoyé est celui déjà en DB, pas une nouvelle écriture.
    expect(body.plan).toBe("business");
  });

  test("idempotency_key transmis à planHistory.create", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    await call(v2Body({ plan: "pro", idempotency_key: "key-abc" }));
    expect(
      mocks.tenantUpdate.mock.calls[0][0].data.planHistory.create
        .idempotencyKey,
    ).toBe("key-abc");
  });

  test("une vraie erreur DB (non-P2002) n'est pas avalée", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockRejectedValueOnce(new Error("connection lost"));
    await expect(call(v2Body({ plan: "pro" }))).rejects.toThrow(
      "connection lost",
    );
  });

  // ── Invariant 5 — immunité plans offerts §3.4.4 ────────────────────────
  test("409 plan_source_immutable — stripe ne downgrade pas un grant_manual", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "business",
      planSource: "grant_manual",
    });
    const res = await call(
      v2Body({ plan: "free", plan_source: "stripe" }),
    );
    expect(res.status).toBe(409);
    expect(((await readJson(res)) as { error: string }).error).toBe(
      "plan_source_immutable",
    );
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  test("409 — downgrade_auto ne downgrade pas un grant_manual non plus", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "business",
      planSource: "grant_manual",
    });
    expect(
      (await call(v2Body({ plan: "free", plan_source: "downgrade_auto" })))
        .status,
    ).toBe(409);
  });

  test("409 — stripe_trial ne downgrade pas un grant_manual non plus", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "business",
      planSource: "grant_manual",
    });
    expect(
      (await call(v2Body({ plan: "pro", plan_source: "stripe_trial" })))
        .status,
    ).toBe(409);
  });

  test("409 — legacy planSource 'internal' (rows pré-v2) reste immune", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "internal",
      planSource: "internal",
    });
    expect(
      (await call(v2Body({ plan: "free", plan_source: "stripe" }))).status,
    ).toBe(409);
  });

  test("409 — legacy planSource 'lifetime_partner' reste immune", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "lifetime_partner",
      planSource: "lifetime_partner",
    });
    expect(
      (await call(v2Body({ plan: "free", plan_source: "stripe" }))).status,
    ).toBe(409);
  });

  test("200 — grant_manual entrant PEUT écraser un tenant grant_manual (admin a le dernier mot)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "business",
      planSource: "grant_manual",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(
      v2Body({ plan: "pro", plan_source: "grant_manual" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.tenantUpdate).toHaveBeenCalledOnce();
  });

  test("200 — grant_manual entrant PEUT écraser un tenant Stripe payant", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "pro",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    expect(
      (await call(v2Body({ plan: "business", plan_source: "grant_manual" })))
        .status,
    ).toBe(200);
  });

  // ── Réponse nominale ───────────────────────────────────────────────────
  test("200 nominal — réponse contient plan/previous_plan/plan_source/applied_at", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const res = await call(
      v2Body({ plan: "pro", plan_source: "stripe", reason: "checkout" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      plan: string;
      previous_plan: string;
      plan_source: string;
      applied_at: string;
    };
    expect(body.tenant_id).toBe("t-1");
    expect(body.plan).toBe("pro");
    expect(body.previous_plan).toBe("freemium");
    expect(body.plan_source).toBe("stripe");
    expect(body.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const call0 = mocks.tenantUpdate.mock.calls[0][0];
    expect(call0.data.planHistory.create.previousPlan).toBe("freemium");
    expect(call0.data.planHistory.create.reason).toBe("checkout");
  });

  test("previous_plan=null si le tenant n'avait pas encore de plan", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: null,
      planSource: null,
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const body = (await readJson(
      await call(v2Body({ plan: "free", plan_source: "downgrade_auto" })),
    )) as { previous_plan: string | null };
    expect(body.previous_plan).toBeNull();
  });
});
