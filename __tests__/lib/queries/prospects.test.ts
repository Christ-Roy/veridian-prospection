/**
 * Tests focalisés sur l'injection du VisibilityScope dans getProspects,
 * suite au refactor cross-membre (2026-05-19).
 *
 * Périmètre :
 *   - VisibilityScope passé → clause buildOutreachWhere ajoutée au WHERE
 *   - VisibilityScope omis → comportement legacy (back-compat counts publics)
 *   - L'ancien `filters.userFilter` est ignoré (remplacé par helper)
 *
 * Le reste de getProspects (NAF presets, sort, freemium quota, etc.) reste
 * en tests-pending.txt.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const queryMock = vi.fn().mockResolvedValue([{ count: 0n }]);
const dataQueryMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

import { getProspects } from "@/lib/queries/prospects";
import type { VisibilityScope } from "@/lib/queries/visibility";
import { prisma } from "@/lib/prisma";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";

function setupPrismaMock() {
  // 1er call = COUNT, 2e call = SELECT data
  let callCount = 0;
  (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    callCount++;
    return callCount === 1 ? [{ count: 0n }] : [];
  });
}

describe("getProspects — visibility scope 2026-05-19", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPrismaMock();
  });

  test("sans visibility : pas de clause OR/AND user_id (comportement legacy)", async () => {
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
    }, T);
    const countSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Pas de clause de visibilité ajoutée
    expect(countSql).not.toMatch(/o\.siren IS NULL OR \(o\.user_id/);
  });

  test("avec visibility=discovery : clause anti double appel injectée", async () => {
    const visibility: VisibilityScope = {
      mode: "discovery",
      tenantId: T,
      userId: U,
      workspaceIds: null,
    };
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
      visibility,
    }, T);
    const countSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(countSql).toContain("o.siren IS NULL");
    expect(countSql).toContain(`o.user_id = '${U}'`);
    expect(countSql).toContain("COALESCE(o.status, 'a_contacter') = 'a_contacter'");
  });

  test("avec visibility=admin : TRUE clause (pas de filtre user)", async () => {
    const visibility: VisibilityScope = {
      mode: "admin",
      tenantId: T,
      userId: U,
      workspaceIds: null,
    };
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
      visibility,
    }, T);
    const countSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(countSql).toContain("(TRUE)");
    expect(countSql).not.toMatch(/o\.user_id\s*=/);
  });

  test("filters.userFilter legacy n'a plus d'effet (helper visibility prend le relais)", async () => {
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
      filters: { userFilter: U },  // legacy, ignoré
    }, T);
    const countSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // L'ancien comportement appliquait `o.user_id = ?` via paramètre positional.
    // Maintenant la clause est supprimée du buildFilterWhere.
    expect(countSql).not.toMatch(/o\.user_id\s*=\s*\$/);
  });
});
