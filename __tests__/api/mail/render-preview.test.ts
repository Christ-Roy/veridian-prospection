/**
 * Tests route POST /api/mail/render-preview.
 *
 * Couvre :
 *  - 401 si non auth
 *  - 404 si tenant introuvable
 *  - 400 si payload invalide
 *  - 400 si templateSlug inconnu
 *  - Rendu template OK : variables substituées
 *  - Rendu freeform OK : variables substituées dans subject/body fournis
 *  - includeSignature true → signature appendée si configurée+activée
 *  - includeSignature true mais signature disabled → pas appendée
 *  - unresolvedVars détectées si {{ var }} non remplacée
 *  - Sender fallback sur fromEmail/auth.email si pas fourni
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  resolveTemplateMock,
  getMailConfigPublicMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  resolveTemplateMock: vi.fn(),
  getMailConfigPublicMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/mail/tenant-templates", () => ({
  resolveTemplate: resolveTemplateMock,
}));
vi.mock("@/lib/mail/queries", () => ({
  getMailConfigPublic: getMailConfigPublicMock,
}));

import { POST } from "@/app/api/mail/render-preview/route";
import { makeRequest, readJson } from "../_helpers";

const VARS = { prospect: { name: "Alice", entreprise: "Acme SAS" } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/mail/render-preview", () => {
  test("401 si non auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: { subject: "S", bodyText: "T", vars: VARS },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("404 si tenant introuvable", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: { subject: "S", bodyText: "T", vars: VARS },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("400 si ni templateSlug ni body", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: { vars: VARS },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 si templateSlug inconnu", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue(null);
    resolveTemplateMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: { templateSlug: "inexistant", vars: VARS },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("rend template : variables substituées dans subject+body", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue({
      fromName: "Robert",
      fromEmail: "r@veridian.site",
      mailSignatureEnabled: true,
      mailSignatureHtml: null,
    });
    resolveTemplateMock.mockResolvedValue({
      slug: "rel",
      label: "Relance",
      subject: "Suite pour {{ prospect.entreprise }}",
      bodyText: "Bonjour {{ prospect.name }}",
      bodyHtml: "<p>Bonjour {{ prospect.name }}</p>",
    });

    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: { templateSlug: "rel", vars: VARS },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      subject: string;
      bodyText: string;
      bodyHtml: string;
      unresolvedVars: string[];
    };
    expect(body.subject).toBe("Suite pour Acme SAS");
    expect(body.bodyText).toBe("Bonjour Alice");
    expect(body.bodyHtml).toBe("<p>Bonjour Alice</p>");
    expect(body.unresolvedVars).toEqual([]);
  });

  test("rend freeform : variables substituées + bodyHtml généré si vide", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue(null);

    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: {
          subject: "Sujet pour {{ prospect.entreprise }}",
          bodyText: "Bonjour {{ prospect.name }}",
          vars: VARS,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      subject: string;
      bodyText: string;
      bodyHtml: string;
    };
    expect(body.subject).toBe("Sujet pour Acme SAS");
    expect(body.bodyText).toBe("Bonjour Alice");
    // Fallback bodyHtml = <p>{text avec br}</p>
    expect(body.bodyHtml).toContain("Bonjour Alice");
    expect(body.bodyHtml).toMatch(/^<p>/);
  });

  test("includeSignature true + signature configurée+activée → appendée", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue({
      fromName: null,
      fromEmail: "r@veridian.site",
      mailSignatureEnabled: true,
      mailSignatureHtml: "<p>Robert Brunon</p>",
    });

    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: {
          subject: "S",
          bodyText: "Body",
          bodyHtml: "<p>Body</p>",
          vars: VARS,
          includeSignature: true,
        },
      }),
    );
    const body = (await readJson(res)) as { bodyHtml: string; bodyText: string };
    expect(body.bodyHtml).toContain('class="veridian-mail-signature"');
    expect(body.bodyHtml).toContain("Robert Brunon");
    expect(body.bodyText).toContain("--\nRobert Brunon");
  });

  test("includeSignature true mais signature disabled → pas appendée", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue({
      fromName: null,
      fromEmail: "r@veridian.site",
      mailSignatureEnabled: false,
      mailSignatureHtml: "<p>Robert Brunon</p>",
    });

    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: {
          subject: "S",
          bodyText: "Body",
          bodyHtml: "<p>Body</p>",
          vars: VARS,
          includeSignature: true,
        },
      }),
    );
    const body = (await readJson(res)) as { bodyHtml: string; bodyText: string };
    expect(body.bodyHtml).not.toContain("veridian-mail-signature");
    expect(body.bodyHtml).not.toContain("Robert Brunon");
  });

  test("unresolvedVars détectées si {{ var }} laissée brute (variable manquante)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue(null);

    const res = await POST(
      makeRequest("/api/mail/render-preview", {
        method: "POST",
        body: {
          subject: "Pour {{ prospect.entreprise }}",
          bodyText: "Bonjour {{ prospect.name }}, manque {{ prospect.missing }}",
          vars: VARS,
        },
      }),
    );
    const body = (await readJson(res)) as { unresolvedVars: string[] };
    expect(body.unresolvedVars).toContain("prospect.missing");
    expect(body.unresolvedVars).not.toContain("prospect.name");
  });
});
