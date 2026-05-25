/**
 * Tests route /api/mail/generate — POST.
 *
 * Couvre :
 *  - 401 si pas auth
 *  - 404 si tenant pas trouvé
 *  - 429 rate limited (30/min)
 *  - 400 si payload Zod invalide
 *  - 412 si AI pas configurée pour le tenant (ni tenant config, ni clé
 *    Veridian globale)
 *  - 404 si SIREN n'existe pas dans entreprises
 *  - 401 si adapter renvoie kind=auth (clé revoke)
 *  - 502 si LLM renvoie une réponse non parsable (anti-régression)
 *  - 200 + body {subject, body_text, body_html} sur succès (tenant-byo)
 *  - 200 + mode=veridian-free quand resolver tombe sur la clé Veridian
 *    (fallback Palier 1 — pas de tenant config, ENV présente)
 *  - audit metadata.mode reflète le mode résolu (anti-régression observability)
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
  resolveAdapterMock,
  getProspectTimelineMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  logAuditMock: vi.fn(),
  prismaMock: { entreprise: { findUnique: vi.fn() } },
  getAiConfigInternalMock: vi.fn(),
  recordAiUsageMock: vi.fn(),
  resolveAdapterMock: vi.fn(),
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
vi.mock("@/lib/ai/resolver", () => ({ resolveAdapter: resolveAdapterMock }));
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

  test("412 si AI pas configurée pour le tenant (resolver retourne null)", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    // resolveAdapter retourne null = aucune voie : pas de tenant config,
    // pas d'OPENROUTER_VERIDIAN_KEY env.
    getAiConfigInternalMock.mockResolvedValue(null);
    resolveAdapterMock.mockResolvedValue(null);
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("not_configured");
  });

  test("404 si SIREN introuvable dans entreprises", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    resolveAdapterMock.mockResolvedValue({
      adapter: { generateText: vi.fn() },
      mode: "tenant-byo",
      provider: "anthropic",
      model: "claude-opus-4-7",
      tenantId: "t-1",
    });
    prismaMock.entreprise.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(404);
  });

  test("401 si la clé est invalide (adapter kind=auth)", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    resolveAdapterMock.mockResolvedValue({
      adapter: {
        generateText: vi.fn().mockRejectedValue(new AiAdapterError("auth", "401")),
      },
      mode: "tenant-byo",
      provider: "anthropic",
      model: "claude-opus-4-7",
      tenantId: "t-1",
    });
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(401);
  });

  test("502 si LLM renvoie une réponse non parsable", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    resolveAdapterMock.mockResolvedValue({
      adapter: {
        generateText: vi.fn().mockResolvedValue({
          text: "je suis désolé je ne peux pas répondre", // pas du JSON
          tokensIn: 50,
          tokensOut: 10,
        }),
      },
      mode: "tenant-byo",
      provider: "anthropic",
      model: "claude-opus-4-7",
      tenantId: "t-1",
    });
    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(502);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("parse_failed");
  });

  test("200 + body {subject, body_text, body_html} + audit (mode tenant-byo)", async () => {
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
    resolveAdapterMock.mockResolvedValue({
      adapter: { generateText: generateMock },
      mode: "tenant-byo",
      provider: "anthropic",
      model: "claude-opus-4-7",
      tenantId: "t-1",
    });

    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      subject: string;
      body_text: string;
      body_html: string;
      tokens_used: { in: number; out: number };
      model_used: string;
      provider_used: string;
      mode: string;
    };
    // Assert sur le RETOUR RÉEL (anti-sabotage)
    expect(body.subject).toContain("Site WordPress");
    expect(body.body_text).toContain("Bonjour Jean");
    expect(body.body_html).toContain("<br>");
    expect(body.body_html).toContain("<p>");
    expect(body.tokens_used).toEqual({ in: 800, out: 120 });
    expect(body.model_used).toBe("claude-opus-4-7");
    expect(body.provider_used).toBe("anthropic");
    expect(body.mode).toBe("tenant-byo");
    // L'adapter a bien reçu un prompt enrichi (contient le nom de l'entreprise).
    const promptArgs = generateMock.mock.calls[0];
    expect(promptArgs[0]).toContain("ACME PLOMBERIE");
    expect(promptArgs[1].system).toBeDefined();
    // Audit log appelé avec le mode résolu (observability Palier 1)
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail.ai_generated",
        targetType: "prospect",
        targetId: "123456789",
        metadata: expect.objectContaining({ mode: "tenant-byo", provider: "anthropic" }),
      }),
    );
    // Métriques fire-and-forget : tenant-byo bump tenant_ai_config.last_used_at
    expect(recordAiUsageMock).toHaveBeenCalledWith("t-1", 800, 120);
  });

  // ── Palier 1 : fallback Veridian (OPENROUTER_VERIDIAN_KEY env, modèle :free) ──
  test("200 + mode=veridian-free quand resolver tombe sur la clé Veridian globale", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    // Pas de tenant config — tombe sur Veridian fallback côté resolver
    getAiConfigInternalMock.mockResolvedValue(null);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    const generateMock = vi.fn().mockResolvedValue({
      text: '{"subject":"S","body":"Bonjour Jean,\\nVotre site mérite un coup de jeune"}',
      tokensIn: 400,
      tokensOut: 60,
    });
    resolveAdapterMock.mockResolvedValue({
      adapter: { generateText: generateMock },
      mode: "veridian-free",
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });

    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      mode: string;
      provider_used: string;
      model_used: string;
    };
    expect(body.mode).toBe("veridian-free");
    expect(body.provider_used).toBe("openrouter");
    expect(body.model_used).toBe("meta-llama/llama-3.3-70b-instruct:free");
    // En veridian-free : pas de recordAiUsage (pas de tenant_ai_config).
    // C'est délibéré — la clé Veridian est globale, on n'a pas de DB row à bump.
    expect(recordAiUsageMock).not.toHaveBeenCalled();
    // Audit reflète bien le mode
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mode: "veridian-free", provider: "openrouter" }),
      }),
    );
  });

  // ── Phase 2/3 timeline 360° — mail_out + call dans le contexte IA ─────
  // L'extension de getProspectTimeline ajoute 2 nouveaux types (mail_out,
  // call). La route mail/generate les mappe vers TimelineEventCtx via un
  // switch. Si demain on ajoute un nouveau type côté query SANS étendre le
  // switch, TypeScript émet une erreur ET les tests ci-dessous garantissent
  // que les events arrivent bien dans le prompt envoyé à l'IA (pas perdus
  // silencieusement).

  test("timeline mail_out → summary du mail injecté dans le prompt envoyé à l'IA", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    getProspectTimelineMock.mockResolvedValue([
      {
        type: "mail_out",
        id: "mail-uuid-1",
        occurredAt: "2026-05-22T09:30:00Z",
        subject: "Bonjour Robert — démo Veridian",
        bodyPreview: "Je vous propose une démo demain à 14h",
        templateSlug: "cold-intro-v3",
        fromEmail: "robert@veridian.site",
        toEmails: ["j@acme.fr"],
        status: "sent",
      },
    ]);
    const generateMock = vi.fn().mockResolvedValue({
      text: '{"subject":"Relance","body":"Bonjour Jean,\\nSuite à mon précédent mail..."}',
      tokensIn: 500,
      tokensOut: 80,
    });
    resolveAdapterMock.mockResolvedValue({ adapter: { generateText: generateMock }, mode: "tenant-byo", provider: "anthropic", model: "claude-opus-4-7", tenantId: "t-1" });

    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(200);

    // Le prompt envoyé à l'IA DOIT contenir :
    //  - Le summary mail formaté ("mail envoyé: ...")
    //  - Le tag [email_outgoing] (mapping mail_out → email_outgoing côté
    //    builder pour ne pas révéler la convention DB interne à l'IA)
    //  - Le subject du mail précédent (l'IA doit pouvoir éviter les
    //    répétitions, ou faire référence)
    const userPrompt = generateMock.mock.calls[0][0] as string;
    expect(userPrompt).toContain("[email_outgoing]");
    expect(userPrompt).toContain("Bonjour Robert");
    expect(userPrompt).toContain("démo Veridian");
    expect(userPrompt).toContain("sent");
  });

  test("timeline call → summary appel injecté dans le prompt (direction + durée)", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    getProspectTimelineMock.mockResolvedValue([
      {
        type: "call",
        id: "42",
        occurredAt: "2026-05-24T14:15:00Z",
        direction: "outbound",
        status: "completed",
        durationSeconds: 195,
        recordingPath: null,
        notes: null,
        provider: "telnyx",
      },
    ]);
    const generateMock = vi.fn().mockResolvedValue({
      text: '{"subject":"Suite à notre appel","body":"Bonjour Jean,\\nComme convenu..."}',
      tokensIn: 500,
      tokensOut: 80,
    });
    resolveAdapterMock.mockResolvedValue({ adapter: { generateText: generateMock }, mode: "tenant-byo", provider: "anthropic", model: "claude-opus-4-7", tenantId: "t-1" });

    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(200);

    const userPrompt = generateMock.mock.calls[0][0] as string;
    expect(userPrompt).toContain("[call]");
    expect(userPrompt).toContain("appel outbound");
    expect(userPrompt).toContain("completed");
    expect(userPrompt).toContain("195s");
  });

  test("timeline mixte (transition + mail_out + call) → les 3 types arrivent dans le prompt", async () => {
    requireAuthMock.mockResolvedValue(AUTH_OK);
    getTenantIdMock.mockResolvedValue("t-1");
    getAiConfigInternalMock.mockResolvedValue(AI_CFG_OK);
    prismaMock.entreprise.findUnique.mockResolvedValue(ENT_OK);
    getProspectTimelineMock.mockResolvedValue([
      {
        type: "pipeline_transition",
        id: "tr-1",
        occurredAt: "2026-05-20T10:00:00Z",
        fromStage: "a_contacter",
        toStage: "contacte",
        userId: "u-1",
      },
      {
        type: "mail_out",
        id: "m-1",
        occurredAt: "2026-05-22T09:00:00Z",
        subject: "Premier mail",
        bodyPreview: "x",
        templateSlug: null,
        fromEmail: "robert@veridian.site",
        toEmails: ["j@acme.fr"],
        status: "sent",
      },
      {
        type: "call",
        id: "1",
        occurredAt: "2026-05-24T11:00:00Z",
        direction: "outbound",
        status: "completed",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        provider: "telnyx",
      },
    ]);
    const generateMock = vi.fn().mockResolvedValue({
      text: '{"subject":"S","body":"B"}',
      tokensIn: 500,
      tokensOut: 80,
    });
    resolveAdapterMock.mockResolvedValue({ adapter: { generateText: generateMock }, mode: "tenant-byo", provider: "anthropic", model: "claude-opus-4-7", tenantId: "t-1" });

    const res = await POST(makeRequest("/api/mail/generate", { method: "POST", body: validBody() }));
    expect(res.status).toBe(200);

    const userPrompt = generateMock.mock.calls[0][0] as string;
    expect(userPrompt).toContain("[pipeline_transition]");
    expect(userPrompt).toContain("[email_outgoing]");
    expect(userPrompt).toContain("[call]");
    expect(userPrompt).toContain("a_contacter");
    expect(userPrompt).toContain("Premier mail");
    expect(userPrompt).toContain("appel outbound");
  });
});
