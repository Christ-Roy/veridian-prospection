/**
 * Test source-level RBAC pour les routes /api/integrations/openrouter/*
 *
 * Vérifie que chaque route OAuth PKCE déclare les gardes attendues :
 *   - connect : requireAuth + cookie signé HMAC + redirect openrouter.ai
 *   - callback : requireAuth + verify cookie + state CSRF + userId match + rate limit
 *   - disconnect : requireAuth + soft delete via disconnectOpenRouterLink
 *   - status : requireAuth
 *
 * Régression possible si un refactor supprime un check → cette suite tilt
 * avant d'arriver en CI ou en prod.
 *
 * Run: npx vitest run src/app/api/integrations/openrouter/openrouter-rbac.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("GET /api/integrations/openrouter/connect", () => {
  const src = read("src/app/api/integrations/openrouter/connect/route.ts");

  it("appelle requireAuth() (Auth.js v5)", () => {
    expect(src).toContain("requireAuth()");
  });

  it("retourne 401 si auth.error", () => {
    expect(src).toMatch(/if\s*\(\s*auth\.error\s*\)/);
  });

  it("génère verifier + challenge S256", () => {
    expect(src).toContain("generateCodeVerifier()");
    expect(src).toContain("generateCodeChallenge(");
  });

  it("génère state CSRF", () => {
    expect(src).toContain("generateState()");
  });

  it("stocke verifier + state + userId signé HMAC dans cookie HTTP-only", () => {
    expect(src).toContain("PKCE_COOKIE_NAME");
    expect(src).toMatch(/httpOnly:\s*true/);
    expect(src).toContain("signPayload");
  });

  it("cookie sameSite=lax (compat redirect cross-site)", () => {
    expect(src).toMatch(/sameSite:\s*"lax"/);
  });

  it("redirect vers openrouter.ai/auth (jamais une autre origin)", () => {
    expect(src).toContain("buildAuthorizeUrl");
  });

  it("importe signPayload depuis @/lib/openrouter/cookie (pas d'export custom dans route.ts)", () => {
    // Next.js App Router refuse les exports non-HTTP-verb dans route.ts —
    // donc PKCE_COOKIE_NAME / signPayload / verifyPayload doivent vivre
    // dans lib/openrouter/cookie.ts, pas exportés depuis le fichier route.
    expect(src).toContain('from "@/lib/openrouter/cookie"');
    expect(src).not.toMatch(/export\s+function\s+verifyPayload/);
    expect(src).not.toMatch(/export\s+const\s+PKCE_COOKIE_NAME/);
  });
});

describe("GET /api/integrations/openrouter/callback", () => {
  const src = read("src/app/api/integrations/openrouter/callback/route.ts");

  it("appelle requireAuth()", () => {
    expect(src).toContain("requireAuth()");
  });

  it("rate-limit configuré (or-callback:)", () => {
    expect(src).toContain("isRateLimited");
    expect(src).toContain("or-callback:");
  });

  it("redirect ai_error=missing_code_or_state si query incomplet", () => {
    expect(src).toContain("missing_code_or_state");
  });

  it("redirect ai_error=missing_pkce_cookie si cookie absent", () => {
    expect(src).toContain("missing_pkce_cookie");
  });

  it("redirect ai_error=invalid_pkce_cookie si signature HMAC KO", () => {
    expect(src).toContain("invalid_pkce_cookie");
    expect(src).toContain("verifyPayload(cookie)");
  });

  it("redirect ai_error=pkce_expired si cookie exp dépassé", () => {
    expect(src).toContain("pkce_expired");
    expect(src).toMatch(/payload\.exp/);
  });

  it("CSRF : compare state cookie vs state query → ai_error=state_mismatch", () => {
    expect(src).toContain("state_mismatch");
    // Doit être une vraie condition active, pas désactivée via `if (false && ...)`
    expect(src).toMatch(/if\s*\(\s*payload\.state\s*!==\s*stateQuery\s*\)/);
  });

  it("anti link-jack : compare userId cookie vs user session → ai_error=user_mismatch", () => {
    expect(src).toContain("user_mismatch");
    expect(src).toMatch(/if\s*\(\s*payload\.userId\s*!==\s*auth\.user\.id\s*\)/);
  });

  it("appelle exchangeCodeForKey({ code, codeVerifier })", () => {
    expect(src).toContain("exchangeCodeForKey");
  });

  it("upsertOpenRouterLink avec apiKey (jamais en clair en DB — encrypt côté queries)", () => {
    expect(src).toContain("upsertOpenRouterLink");
  });

  it("delete cookie PKCE avant redirection (one-shot, anti-replay)", () => {
    expect(src).toMatch(/cookies\.delete\(\s*PKCE_COOKIE_NAME/);
  });

  it("logAudit action=openrouter.connected", () => {
    expect(src).toContain("openrouter.connected");
  });
});

describe("DELETE /api/integrations/openrouter/disconnect", () => {
  const src = read("src/app/api/integrations/openrouter/disconnect/route.ts");

  it("appelle requireAuth()", () => {
    expect(src).toContain("requireAuth()");
  });

  it("soft delete via disconnectOpenRouterLink (jamais DELETE physique)", () => {
    expect(src).toContain("disconnectOpenRouterLink");
    expect(src).not.toMatch(/\bdelete\s*\(\s*\{\s*where/); // pas de prisma.delete()
  });

  it("logAudit action=openrouter.disconnected", () => {
    expect(src).toContain("openrouter.disconnected");
  });

  it("retourne 204 No Content", () => {
    expect(src).toContain("status: 204");
  });
});

describe("GET /api/integrations/openrouter/status", () => {
  const src = read("src/app/api/integrations/openrouter/status/route.ts");

  it("appelle requireAuth()", () => {
    expect(src).toContain("requireAuth()");
  });

  it("expose veridianFallbackAvailable basé sur OPENROUTER_VERIDIAN_KEY", () => {
    expect(src).toContain("OPENROUTER_VERIDIAN_KEY");
    expect(src).toContain("veridianFallbackAvailable");
  });

  it("retourne la vue publique (pas apiKeyEnc)", () => {
    expect(src).toContain("getOpenRouterLinkPublic");
    expect(src).not.toContain("getOpenRouterLinkInternal");
  });
});
