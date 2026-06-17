import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authenticateSearch, DEFAULT_SEARCH_TENANT } from "./auth";

const SECRET = "test-search-secret-abc123";

function reqWith(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("https://x/api/search/estimate", { method: "POST", headers });
}

describe("authenticateSearch", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env.SEARCH_API_SECRET = SECRET;
    delete process.env.TENANT_API_SECRET;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("accepte un bearer valide et résout le tenant par défaut", () => {
    const r = authenticateSearch(reqWith(`Bearer ${SECRET}`));
    expect(r.ok).toBe(true);
    expect(r.tenantId).toBe(DEFAULT_SEARCH_TENANT);
  });

  it("refuse l'absence de header (401)", () => {
    const r = authenticateSearch(reqWith());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("refuse un mauvais token (401)", () => {
    const r = authenticateSearch(reqWith("Bearer wrong"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("refuse un token sans préfixe Bearer (401)", () => {
    const r = authenticateSearch(reqWith(SECRET));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("fallback sur TENANT_API_SECRET si SEARCH_API_SECRET absent", () => {
    delete process.env.SEARCH_API_SECRET;
    process.env.TENANT_API_SECRET = SECRET;
    const r = authenticateSearch(reqWith(`Bearer ${SECRET}`));
    expect(r.ok).toBe(true);
  });

  it("retourne 500 si aucun secret configuré", () => {
    delete process.env.SEARCH_API_SECRET;
    delete process.env.TENANT_API_SECRET;
    const r = authenticateSearch(reqWith(`Bearer ${SECRET}`));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
  });
});
