/**
 * POST /api/mcp : sans jeton du Hub valide, ou pour un compte inconnu, rien ne passe.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const { verifier, findFirst, buildCtx, espace, presence } = vi.hoisted(() => ({
  presence: vi.fn(async () => {}),
  verifier: vi.fn(),
  findFirst: vi.fn(),
  buildCtx: vi.fn(),
  espace: vi.fn(),
}));
vi.mock("@/lib/mcp/jeton-hub", async (orig) => ({ ...(await orig<typeof import("@/lib/mcp/jeton-hub")>()), verifierJetonHub: verifier }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst } } }));
vi.mock("@/lib/auth/user-context", () => ({ buildUserContext: buildCtx, espaceHub: espace, resolveInsertWorkspaceId: vi.fn(async () => "ws-1") }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock("@/atlas/presence-ia", () => ({ noterPresence: presence }));
vi.mock("@/lib/mcp/protocole", () => ({
  traiter: vi.fn(async (m: { id?: number }) => (m.id === undefined ? null : { jsonrpc: "2.0", id: m.id, result: { ok: true } })),
}));

import { POST, GET } from "@/app/api/mcp/route";
import { JetonRefuse } from "@/lib/mcp/jeton-hub";
import { NextRequest } from "next/server";

const req = (corps: unknown, jeton?: string) =>
  new NextRequest("https://prospection.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify(corps),
  });
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("POST /api/mcp", () => {
  test("sans jeton : 401", async () => {
    expect((await POST(req(INIT))).status).toBe(401);
    expect(verifier).not.toHaveBeenCalled();
  });

  test("jeton refusé : 401 avec le motif", async () => {
    verifier.mockRejectedValue(new JetonRefuse("jeton destiné à une autre app"));
    const r = await POST(req(INIT, "x.y.z"));
    expect(r.status).toBe(401);
    expect((await r.json()).error.message).toMatch(/autre app/);
  });

  test("utilisateur inconnu de Prospection : 401, aucun compte créé", async () => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr" });
    findFirst.mockResolvedValue(null);
    const r = await POST(req(INIT, "x.y.z"));
    expect(r.status).toBe(401);
    // Le Hub reconnaît ce code pour créer le compte et réessayer.
    expect(await r.text()).toContain("hub_user_unknown");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", deletedAt: null } }));
  });

  test("compte sans espace : 403", async () => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr" });
    findFirst.mockResolvedValue({ id: "u-1", email: "a@b.fr" });
    buildCtx.mockResolvedValue(null);
    expect((await POST(req(INIT, "x.y.z"))).status).toBe(403);
  });

  test("compte connu : réponse JSON-RPC ; notification seule : 202", async () => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr", clientId: "claude", tenantId: "t-signe" });
    findFirst.mockResolvedValue({ id: "u-1", email: "a@b.fr" });
    espace.mockResolvedValue({ id: "t-1" });
    buildCtx.mockResolvedValue({ userId: "u-1", tenantId: "t-1", workspaces: [], isAdmin: false });
    const r = await POST(req(INIT, "x.y.z"));
    expect(r.status).toBe(200);
    expect(buildCtx).toHaveBeenCalledWith({ id: "u-1", email: "a@b.fr" }, null, "t-1");
    // L'espace signé est résolu vers le tenant local relié, appartenance vérifiée, puis imposé.
    expect(espace).toHaveBeenCalledWith("u-1", "t-signe");
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect((await POST(req({ jsonrpc: "2.0", method: "notifications/initialized" }, "x.y.z"))).status).toBe(202);
  });

  test("chaque appel authentifié note l'IA branchée ; une panne de cette écriture ne bloque rien", async () => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr", clientId: "mcpc_x", clientNom: "Claude", tenantId: null });
    findFirst.mockResolvedValue({ id: "u-1", email: "a@b.fr" });
    buildCtx.mockResolvedValue({ userId: "u-1", tenantId: "t-1", workspaces: [], isAdmin: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    presence.mockRejectedValueOnce(new Error("base muette"));
    expect((await POST(req(INIT, "x.y.z"))).status).toBe(200);
    expect(presence).toHaveBeenCalledWith("u-1", "mcpc_x", "Claude");
  });

  test("jeton refusé : aucune présence notée", async () => {
    presence.mockClear();
    verifier.mockRejectedValue(new JetonRefuse("jeton expiré"));
    expect((await POST(req(INIT, "x.y.z"))).status).toBe(401);
    expect(presence).not.toHaveBeenCalled();
  });

  test.each([
    ["tenant_not_linked", "espace Hub relié à rien"],
    ["tenant_forbidden", "espace d'un autre"],
  ])("tenant_id signé %s (%s) : 403 avec le code, jamais l'espace par défaut", async (code) => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr", tenantId: "9b2d1c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e" });
    findFirst.mockResolvedValue({ id: "u-1", email: "a@b.fr" });
    espace.mockResolvedValue(code);
    const r = await POST(req(INIT, "x.y.z"));
    expect(r.status).toBe(403);
    expect(await r.text()).toContain(code);
    expect(buildCtx).not.toHaveBeenCalled();
  });

  test("le contexte retombe sur un autre espace que celui demandé : 403, pas de repli", async () => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr", tenantId: "9b2d1c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e" });
    findFirst.mockResolvedValue({ id: "u-1", email: "a@b.fr" });
    espace.mockResolvedValue({ id: "t-demande" });
    buildCtx.mockResolvedValue({ userId: "u-1", tenantId: "t-defaut", workspaces: [], isAdmin: false });
    const r = await POST(req(INIT, "x.y.z"));
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("tenant_forbidden");
  });

  test("sans tenant_id : espace par défaut, aucune résolution d'espace", async () => {
    verifier.mockResolvedValue({ hubUserId: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f", email: "a@b.fr", tenantId: null });
    findFirst.mockResolvedValue({ id: "u-1", email: "a@b.fr" });
    buildCtx.mockResolvedValue({ userId: "u-1", tenantId: "t-defaut", workspaces: [], isAdmin: false });
    expect((await POST(req(INIT, "x.y.z"))).status).toBe(200);
    expect(espace).not.toHaveBeenCalled();
    expect(buildCtx).toHaveBeenCalledWith({ id: "u-1", email: "a@b.fr" }, null, null);
  });

  test("GET : 405, pas de flux serveur", async () => {
    expect((await GET()).status).toBe(405);
  });
});
