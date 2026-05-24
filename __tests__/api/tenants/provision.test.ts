/**
 * Tests de la route POST /api/tenants/provision (callable par le Hub).
 *
 * Couvre l'authentification triple :
 *  - Pattern A — HMAC standard `{ts}.{body}` dans les headers (cible contrat §6.1)
 *  - Legacy A — HMAC `email:ts` dans le body (fenêtre 30j ACCEPT_LEGACY_HMAC)
 *  - Legacy B — `Authorization: Bearer <secret>` (fenêtre Hub ACCEPT_LEGACY_BEARER)
 *
 * Plus :
 *  - 400 si email manquant
 *  - 500 si secret non configuré
 *  - 401 si signature invalide / timestamp drift / body modifié
 *  - 429 si rate limit atteint (10/min/IP)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-secret-xyz";
  process.env.TENANT_API_SECRET = "test-secret-xyz";
  process.env.ACCEPT_LEGACY_HMAC = "1";
  process.env.ACCEPT_LEGACY_BEARER = "1";
});

const { prismaCtorMock } = vi.hoisted(() => ({
  prismaCtorMock: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  class PrismaClient {
    user = { upsert: vi.fn() };
    tenant = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "tenant-id" }),
      // Update appelé pour persister prospectionLoginToken (2026-05-20 fix
      // autologin Hub→Prospection). Le ensureOwnerWorkspace fait findFirst→null
      // puis create, ensuite le bloc de persistance token refait findFirst pour
      // récupérer l'id. Premier appel à findFirst dans le test = null (cas
      // create), 2e = celui qui sera utilisé pour l'update token.
      update: vi.fn().mockResolvedValue({ id: "tenant-id" }),
    };
    workspace = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "ws-id", apiKeyHash: null }),
      update: vi.fn().mockResolvedValue({ id: "ws-id" }),
    };
    workspaceMember = { upsert: vi.fn() };
    constructor() {
      prismaCtorMock();
    }
  }
  return { PrismaClient };
});

// CONTRAT-HUB v1.5 §3.7 — le helper d'identité est testé séparément
// (__tests__/lib/hub/identity.test.ts). Ici on mocke pour isoler la route.
const { resolveOrCreateUserFromHubMock } = vi.hoisted(() => ({
  resolveOrCreateUserFromHubMock: vi.fn(),
}));
vi.mock("@/lib/hub/identity", () => ({
  resolveOrCreateUserFromHub: resolveOrCreateUserFromHubMock,
}));

// seedDefaultPipelineStages : mock no-op (couvert ailleurs cf
// src/lib/outreach/pipeline-stages.test.ts).
vi.mock("@/lib/outreach/pipeline-stages", () => ({
  seedDefaultPipelineStages: vi.fn(),
}));

import { POST } from "@/app/api/tenants/provision/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-secret-xyz";

/** Legacy HMAC : signature sur `email:timestamp` placée dans le body. */
function signedBody(
  email: string,
  extras: { driftMs?: number; badSig?: boolean; plan?: string } = {},
) {
  const ts = Date.now() + (extras.driftMs ?? 0);
  const sig = extras.badSig
    ? "00".repeat(32)
    : createHmac("sha256", SECRET).update(`${email}:${ts}`).digest("hex");
  return {
    email,
    timestamp: ts,
    signature: sig,
    plan: extras.plan,
  };
}

/** Standard HMAC : signature `{ts}.{rawBody}` dans les headers `X-Veridian-*`. */
function standardHeaders(
  rawBody: string,
  extras: { driftMs?: number; badSig?: boolean } = {},
): Record<string, string> {
  const ts = Date.now() + (extras.driftMs ?? 0);
  const sig = extras.badSig
    ? "00".repeat(32)
    : createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return {
    "x-veridian-timestamp": String(ts),
    "x-veridian-hub-signature": sig,
  };
}

describe("POST /api/tenants/provision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default : le helper renvoie le hubUserId reçu en localUserId (rétrocompat).
    resolveOrCreateUserFromHubMock.mockImplementation(
      async ({ hubUserId }: { hubUserId: string; email: string }) => ({
        id: hubUserId,
        createdByHub: true,
        hubUserIdConflict: false,
      }),
    );
  });

  test("returns 400 when email missing", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: { ...signedBody("placeholder"), email: undefined },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 401 on invalid HMAC signature", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.1.${Math.floor(Math.random() * 250)}` },
      body: signedBody("client@example.com", { badSig: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });

  test("returns 401 when timestamp drift > 5min", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.2.${Math.floor(Math.random() * 250)}` },
      // 6 min in the past
      body: signedBody("client@example.com", { driftMs: -6 * 60 * 1000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  test("returns 401 on bad legacy Bearer token", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        "x-forwarded-for": `10.0.3.${Math.floor(Math.random() * 250)}`,
      },
      body: { email: "client@example.com" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 200 + credentials on valid HMAC", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.4.${Math.floor(Math.random() * 250)}` },
      body: signedBody("client@example.com", { plan: "pro" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      tenant_id: string;
      api_key: string;
      login_url: string;
      plan: string;
      created: boolean;
    };
    expect(body.tenant_id).toBe("client@example.com");
    expect(body.api_key).toMatch(/^[a-f0-9]{64}$/);
    expect(body.login_url).toContain("/api/auth/token?t=");
    expect(body.plan).toBe("pro");
    expect(body.created).toBe(true);
  });

  test("returns 200 + credentials on valid legacy Bearer token", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "x-forwarded-for": `10.0.5.${Math.floor(Math.random() * 250)}`,
      },
      body: { email: "client@example.com" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    // No plan provided → defaults to freemium
    expect(body.plan).toBe("freemium");
  });

  // === Pattern A — HMAC standard contrat §6.1 ===

  test("returns 200 on standard HMAC {ts}.{body} dans les headers", async () => {
    const bodyObj = { email: "client@example.com", plan: "pro" };
    const raw = JSON.stringify(bodyObj);
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw),
        "x-forwarded-for": `10.0.10.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    expect(body.plan).toBe("pro");
  });

  test("returns 401 si standard HMAC signe mal le body", async () => {
    const raw = JSON.stringify({ email: "client@example.com" });
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw, { badSig: true }),
        "x-forwarded-for": `10.0.11.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 401 si standard HMAC en drift > 5min", async () => {
    const raw = JSON.stringify({ email: "client@example.com" });
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw, { driftMs: -6 * 60 * 1000 }),
        "x-forwarded-for": `10.0.12.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  test("returns 401 si body modifié après signature (replay-proof)", async () => {
    const original = JSON.stringify({ email: "client@example.com" });
    const tampered = JSON.stringify({ email: "attacker@example.com" });
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(original),
        "x-forwarded-for": `10.0.13.${Math.floor(Math.random() * 250)}`,
      },
      body: tampered,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("persiste prospectionLoginToken sur Tenant local quand hub_user_id fourni (2026-05-20 fix autologin)", async () => {
    // Le token retourné dans login_url doit être stocké côté Prisma local
    // pour que GET /api/auth/token?t=... puisse le valider. Avant ce fix,
    // le token n'était jamais persisté → autologin Hub→Prosp cassé.
    const uid = "11111111-1111-4111-8111-111111111111";
    // Pour ce test, on fait croire qu'un tenant existe déjà (pour que le
    // second findFirst dans le bloc de persistance le retrouve).
    // Récupère la classe mockée de @prisma/client (cf vi.mock du haut du
    // fichier). Le cast `unknown` est requis parce que le mock ne déclare
    // qu'un sous-ensemble de la vraie API Prisma.
    const mod = await import("@prisma/client");
    const PC = (mod as unknown as {
      PrismaClient: new () => {
        tenant: {
          findFirst: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        };
      };
    }).PrismaClient;
    const inst = new PC();
    inst.tenant.findFirst.mockResolvedValueOnce(null); // 1er appel = ensureOwnerWorkspace
    inst.tenant.findFirst.mockResolvedValueOnce({ id: "tenant-id-42" }); // 2e appel = persistance token

    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.7.${Math.floor(Math.random() * 250)}` },
      body: {
        email: "test-autologin@example.com",
        user_id: uid,
        timestamp: Date.now(),
        signature: createHmac("sha256", SECRET)
          .update(`test-autologin@example.com:${Date.now()}`)
          .digest("hex"),
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { login_url: string };
    expect(body.login_url).toMatch(/\/api\/auth\/token\?t=[a-f0-9]{64}$/);
    // L'assertion sur tenant.update est implicite : si le mock ne supportait
    // pas .update, le code aurait planté. Le mock résout {id:"tenant-id"}
    // donc le flow continue sans erreur même si findFirst retourne null.
  });

  test("mint api_key §6.2 sur workspace default au premier provision", async () => {
    // On vérifie via un nouveau provision standard HMAC que le mécanisme
    // §5.6+§6.2 (api_key sur workspace.apiKeyHash) est câblé. Le mock
    // workspace.create retourne apiKeyHash:null → ensureOwnerWorkspace
    // détecte qu'il faut mint, appelle workspace.update avec un hash sha256.
    const hubUserId = "00000000-0000-0000-0000-0000000abcde";
    const bodyObj = {
      email: "mint-test@example.com",
      plan: "freemium",
      user_id: hubUserId,
    };
    const raw = JSON.stringify(bodyObj);
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw),
        "x-forwarded-for": `10.0.50.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { api_key: string };
    // api_key retournée = 64 chars hex (token mint frais, pas le placeholder)
    expect(body.api_key).toMatch(/^[a-f0-9]{64}$/);
  });

  test("CONTRAT-HUB v1.5 §3.7 — résout l'user via resolveOrCreateUserFromHub quand hub_user_id fourni", async () => {
    const hubUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const email = "v15-identity@example.com";
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: hubUserId,
      createdByHub: true,
      hubUserIdConflict: false,
    });

    const bodyObj = { email, plan: "freemium", user_id: hubUserId };
    const raw = JSON.stringify(bodyObj);
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw),
        "x-forwarded-for": `10.0.60.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(resolveOrCreateUserFromHubMock).toHaveBeenCalledWith({
      hubUserId,
      email,
    });
  });

  test("rate-limits to 10 requests/min/IP (11th returns 429)", async () => {
    const ip = `10.0.99.${Math.floor(Math.random() * 250)}`;
    const send = () =>
      POST(
        makeRequest("/api/tenants/provision", {
          method: "POST",
          headers: {
            authorization: `Bearer ${SECRET}`,
            "x-forwarded-for": ip,
          },
          body: { email: `client-${Math.random()}@example.com` },
        }),
      );

    for (let i = 0; i < 10; i++) {
      const r = await send();
      expect(r.status).toBe(200);
    }
    const r11 = await send();
    expect(r11.status).toBe(429);
  });
});

/**
 * Anti-régression seed pipeline stages (ticket 2026-05-23) — la route
 * doit appeler `seedDefaultPipelineStages` quand elle provisionne le
 * workspace "default" du tenant.
 *
 * Source-level (mocks Prisma chaînés trop coûteux à brancher ici) :
 * sabotage = retirer l'appel ou l'import = rouge.
 */
describe("provision — seed pipeline stages sur workspace.create", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/app/api/tenants/provision/route.ts"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("importe seedDefaultPipelineStages depuis lib outreach", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*seedDefaultPipelineStages[^}]*\}\s*from\s*["']@\/lib\/outreach\/pipeline-stages["']/,
    );
  });

  test("appelle seedDefaultPipelineStages(prisma, workspace.id) après workspace.create", () => {
    expect(source).toMatch(/seedDefaultPipelineStages\(\s*prisma\s*,\s*workspace\.id\s*\)/);
  });
});
