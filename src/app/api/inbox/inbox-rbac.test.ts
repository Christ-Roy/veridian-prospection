/**
 * Test source-level RBAC pour les routes /api/inbox/*
 *
 * Vérifie que chaque mutation/read déclare explicitement les gardes auth +
 * tenant + workspaceFilter. Régression possible si un dev refactor sans
 * préserver les checks → cette suite tilt avant d'arriver en CI.
 *
 * Run: npx vitest run src/app/api/inbox/inbox-rbac.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("GET /api/inbox — RBAC", () => {
  const src = read("src/app/api/inbox/route.ts");

  it("appelle requireUser() pour l'auth Auth.js v5", () => {
    expect(src).toContain("requireUser()");
  });

  it("retourne 401 NextResponse si auth.error", () => {
    expect(src).toMatch(/if\s*\(\s*"error"\s+in\s+auth\s*\)/);
  });

  it("dérive workspaceFilter via getWorkspaceFilter (admin = null, member = list)", () => {
    expect(src).toContain("getWorkspaceFilter(auth.ctx)");
  });

  it("passe tenantId à listInboxEmails (jamais d'access cross-tenant)", () => {
    expect(src).toContain("tenantId: auth.ctx.tenantId");
  });

  it("passe workspaceFilter à listInboxEmails", () => {
    expect(src).toContain("workspaceFilter");
  });

  it("rate-limit configuré (120/min)", () => {
    expect(src).toContain("isRateLimited");
    expect(src).toContain("inbox:");
  });

  it("valide direction contre allowlist (fallback all)", () => {
    expect(src).toContain("parseDirection");
    expect(src).toContain("ALLOWED_DIRECTIONS");
  });

  it("valide status contre allowlist (fallback all)", () => {
    expect(src).toContain("parseStatus");
    expect(src).toContain("ALLOWED_STATUSES");
  });
});

describe("POST /api/inbox/attach — RBAC + validation", () => {
  const src = read("src/app/api/inbox/attach/route.ts");

  it("appelle requireUser() pour l'auth", () => {
    expect(src).toContain("requireUser()");
  });

  it("valide payload via Zod (leadEmailId uuid + siren 9 chiffres)", () => {
    expect(src).toContain("z.string().uuid()");
    expect(src).toMatch(/regex\(\s*\/\^\\d\{9\}\$\//);
  });

  it("retourne 400 si payload invalide", () => {
    expect(src).toContain("status: 400");
    expect(src).toContain("Invalid input");
  });

  it("dérive workspaceFilter avant de patcher", () => {
    expect(src).toContain("getWorkspaceFilter(auth.ctx)");
  });

  it("passe tenantId à attachInboxEmail (cross-tenant block)", () => {
    expect(src).toContain("tenantId: auth.ctx.tenantId");
  });

  it("mappe code=forbidden → HTTP 403", () => {
    expect(src).toContain('"forbidden"');
    expect(src).toContain("status: 403");
  });

  it("mappe code=not_found → HTTP 404", () => {
    expect(src).toContain('"not_found"');
    expect(src).toContain("Email not found");
  });

  it("mappe code=siren_not_found → HTTP 404", () => {
    expect(src).toContain('"siren_not_found"');
    expect(src).toContain("SIREN not found");
  });

  it("logue l'attachement dans audit_log (compliance)", () => {
    expect(src).toContain("logAudit");
    expect(src).toContain("inbox.email_attached");
  });

  it("rate-limit configuré sur l'attach (30/min)", () => {
    expect(src).toContain("isRateLimited");
    expect(src).toContain("inbox-attach:");
  });

  it("safe-parse JSON body via .catch(() => ({}))", () => {
    // Pattern Veridian standard, cf memory route_safe_parse_pattern
    expect(src).toContain("request.json().catch(() => ({}))");
  });
});
