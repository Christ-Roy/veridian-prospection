/**
 * Tests route /api/mail/generate — POST.
 *
 * Couvre :
 *  - 401 si pas auth
 *  - 404 si tenant pas trouvé
 *  - 429 rate limited (30/min)
 *  - 400 si payload Zod invalide
 *  - 412 si AI pas configurée pour le tenant
 *  - 404 si SIREN n'existe pas dans entreprises
 *  - 401 si adapter renvoie kind=auth (clé revoke)
 *  - 502 si LLM renvoie une réponse non parsable (anti-régression)
 *  - 200 + body {subject, body_text, body_html} sur succès
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  isRateLimitedMock,
  logAuditMock,
  prismaMock,
  getAiConfigInternalMock,
  recordAiUsageMock,
  getAdapterMock,
  getProspectTimelineMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  logAuditMock: vi.fn(),
  prismaMock: { entreprise: { findUnique: vi.fn() } },
  getAiConfigInternalMock: vi.fn(),
  recordAiUsageMock: vi.fn(),
  getAdapterMock: vi.fn(),
  getProspectTimelineMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ai/queries", () => ({
  getAiConfigInternal: getAiConfigInternalMock,
  recordAiUsage: recordAiUsageMock,
}));
vi.mock("@/lib/ai/adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/adapter")>("@/lib/ai/adapter");
  return { ...actual, getAdapter: getAdapterMock };
});
vi.mock("@/lib/queries/timeline", () => ({
  getProspectTimeline: getProspectTimelineMock,
}));

import { POST } from "@/app/api/mail/generate/route";
import { AiAdapterError } from "@/lib/ai/adapter";
import { makeRequest, readJson } from "../_helpers";

const AUTH_OK = { user: { id: "u-1", email: "u@v.site" } };

const ENT_OK = {
  siren: "123456789",
  denomination: "ACME PLOMBERIE",
  formeJuridique: "SARL",
  codeNaf: "4322A",
  nafLibelle: "Plomberie",
  secteurFinal: "BTP",
  domaineFinal: "BTP",
  trancheEffectifs: "10 à 19 salariés",
  prospectScore: 80,
  prospectTier: "A",
  webObsolescenceScore: 70,
  webTechScore: 20,
  webCms: "WordPress",
  webHasHttps: false,
  webHasResponsive: false,
  webCopyrightYear: 2014,
  adresse: "12 rue x",
  commune: "Lyon",
  departement: "Rhône",
  nbMarchesPublics: 0,
  dirigeantNom: "Dupont",
  dirigeantPrenom: "Jean",
  dirigeantQualite: "Gérant",
  bestEmailNormalized: "j@acme.fr",
};

const AI_CFG_OK = {
  id: "ai-1",
  tenantId: "t-1",
  provider: "anthropic",
  model: "claude-opus-4-7",
  apiKeyEnc: "iv:tag:c",
  defaultLocale: "fr",
};

function validBody() {
  return { siren: "123456789", objective: "intro", tone: "formel" };
}

describe("POST /api/mail/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
    getProspectTimelineMock.mockResolvedValue([]);
  });

  test("401 si pas auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(401);
  });

  test("429 si rate limited", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(429);
  });

  test("404 si pas de tenant", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue(null);
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(404);
  });

  test("400 si payload invalide (SIREN pas 9 chiffres)", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST(
      makeRequest("/api/mail/generate", {
        method: "POST",
        body: { siren: "ABC", objective: "intro", tone: "formel" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 si objective hors enum", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST(
      makeRequest("/api/mail/generate", {
        method: "POST",
        body: { siren: "123456789", objective: "blabla", tone: "formel" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("412 si AI pas configurée pour le tenant", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(null);
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("not_configured");
  });

  test("404 si SIREN introuvable dans entreprises", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(404);
  });

  test("401 si la clé est invalide (adapter kind=auth)", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    getAdapterMock.mockReturnValue({
      generateText: vi.fn().mockRejectedValue(new AiAdapterError("auth", "401")),
    });
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(401);
  });

  test("502 si LLM renvoie une réponse non parsable", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    getAdapterMock.mockReturnValue({
      generateText: vi.fn().mockResolvedValue({
        text: "je suis désolé je ne peux pas répondre", // pas du JSON
        tokensIn: 50,
        tokensOut: 10,
      }),
    });
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(502);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("parse_failed");
  });

  test("200 + body {subject, body_text, body_html} + audit", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    getProspectTimelineMock.mockResolvedValue([
      {
        type: "pipeline_transition",
        id: "x",
        occurredAt: "2026-05-20T10:00:00Z",
        fromStage: "a_contacter",
        toStage: "contacte",
        userId: "u-1",
      },
    ]);
    const generateMock = vi.fn().mockResolvedValue({
      text: '{"subject":"Site WordPress 2014 — un coup d\'œil ?","body":"Bonjour Jean,\\nVotre site ACME est en WordPress depuis 2014..."}',
      tokensIn: 800,
      tokensOut: 120,
    });
    getAdapterMock.mockReturnValue({ generateText: generateMock });

    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      subject: string;
      body_text: string;
      body_html: string;
      tokens_used: { in: number; out: number };
      model_used: string;
      provider_used: string;
    };
    // Assert sur le RETOUR RÉEL (anti-sabotage)
    expect(body.subject).toContain("Site WordPress");
    expect(body.body_text).toContain("Bonjour Jean");
    expect(body.body_html).toContain("<br>");
    expect(body.body_html).toContain("<p>");
    expect(body.tokens_used).toEqual({ in: 800, out: 120 });
    expect(body.model_used).toBe("claude-opus-4-7");
    expect(body.provider_used).toBe("anthropic");
    // L'adapter a bien reçu un prompt enrichi (contient le nom de l'entreprise).
    const promptArgs = generateMock.mock.calls[0];
    expect(promptArgs[0]).toContain("ACME PLOMBERIE");
    expect(promptArgs[1].system).toBeDefined();
    // Audit log appelé
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail.ai_generated",
        targetType: "prospect",
        targetId: "123456789",
      }),
    );
    // Métriques fire-and-forget
    expect(recordAiUsageMock).toHaveBeenCalledWith("t-1", 800, 120);
  });
});
