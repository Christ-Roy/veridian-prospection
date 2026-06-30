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
    return callCount === 1 ? [{ count: BigInt(0) }] : [];
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

// ─── sort tech_debt (mode agence, ticket switch-mode-agence) ─────────────────
//
// Quand l'API /api/prospects détecte workspace.displayMode='agency', elle passe
// sort='tech_debt' à getProspects. Ici on vérifie que la SQL générée trie bien
// sur la formule composite (web_eclate_score * 100 + web_tech_score DESC).
describe("getProspects — sort tech_debt (mode agence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPrismaMock();
  });

  test("sort='tech_debt' injecte web_eclate_score + web_tech_score dans ORDER BY", async () => {
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
      sort: "tech_debt",
      sortDir: "desc",
    }, T);
    // 2e call = SELECT data avec ORDER BY
    const dataSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(dataSql).toContain("ORDER BY");
    expect(dataSql).toContain("web_eclate_score");
    expect(dataSql).toContain("web_tech_score");
    expect(dataSql).toContain("DESC");
  });

  test("sort='tech_debt' avec sortDir='asc' respecte la direction demandée", async () => {
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
      sort: "tech_debt",
      sortDir: "asc",
    }, T);
    const dataSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    // ASC = on remonte d'abord les sites les MOINS éclatés (utile pour
    // audit qualité, peu utile en prospection, mais on respecte l'API).
    expect(dataSql).toMatch(/ORDER BY[\s\S]*web_eclate_score[\s\S]*ASC/);
  });

  test("sort inconnu fallback sur prospect_score (pas de crash SQL)", async () => {
    await getProspects({
      domainId: "all",
      presets: ["tous"],
      page: 1,
      pageSize: 50,
      sort: "champ_qui_n_existe_pas",
    }, T);
    const dataSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(dataSql).toContain("e.prospect_score");
  });

  // Anti-sabotage buildDomainNafWhere — exerce le chemin domain≠"all" qui
  // appelle buildDomainNafWhere (la fonction qui retourne {sql, params} pour
  // le filtre NAF). Si quelqu'un sabote son `return` à null, ce test pète
  // car nafSql.params devient null et $queryRawUnsafe reçoit n'importe quoi.
  test("domain != 'all' produit une clause NAF dans le WHERE (anti-sabotage)", async () => {
    await getProspects({
      domainId: "btp",
      presets: ["btp_artisans"],
      page: 1,
      pageSize: 50,
    }, T);
    const countSql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Présence d'une clause NAF — soit `e.code_naf IN (...)` soit `LIKE`
    // selon la définition du domaine "btp". Si la fonction retourne null,
    // countSql contient "null AND" et ces deux assertions plantent.
    expect(countSql).toMatch(/e\.code_naf/);
    expect(countSql).not.toMatch(/\bnull\b/);
  });
});

// ── Régression critique (2026-06-30) : recherche prospects par DOMAINE web ──
// Un commercial tapait un nom de domaine → 0 résultat (buildFilterWhere ne
// cherchait que denomination/dirigeant/email). Doit aussi chercher le domaine.
import { buildFilterWhere } from "@/lib/queries/prospects";

describe("buildFilterWhere — recherche par domaine web", () => {
  test("inclut web_domain_normalized dans la recherche texte", () => {
    const { sql, params } = buildFilterWhere({ search: "decibel49.com" });
    expect(sql).toContain("e.web_domain_normalized ILIKE ?");
    expect(params).toContain("%decibel49.com%");
  });

  test("normalise le domaine (retire https://, www., path)", () => {
    const { params } = buildFilterWhere({ search: "https://www.decibel49.com/contact" });
    expect(params).toContain("%decibel49.com%");
  });

  test("ne référence PAS web_domain (legacy=SIREN, non indexé → seq scan)", () => {
    const { sql } = buildFilterWhere({ search: "monsite" });
    expect(sql).not.toContain("e.web_domain ILIKE");
  });

  test("une recherche SIREN ne tombe pas dans la recherche domaine", () => {
    const { sql } = buildFilterWhere({ search: "508880044" });
    expect(sql).toContain("e.siren = ?");
    expect(sql).not.toContain("web_domain_normalized ILIKE");
  });
});

describe("buildFilterWhere — la recherche neutralise unseenOnly/requirePhone", () => {
  test("avec search : pas de clause unseenOnly ni requirePhone (cherche dans tout)", () => {
    const { sql } = buildFilterWhere({ search: "decibel49.com", unseenOnly: true, requirePhone: true });
    expect(sql).not.toContain("last_visited IS NULL");
    // la clause requirePhone (best_phone_e164 IS NOT NULL) ne doit pas masquer
    expect(sql).not.toContain("e.best_phone_e164 IS NOT NULL");
    // mais la recherche, elle, est bien présente
    expect(sql).toContain("web_domain_normalized ILIKE");
  });

  test("SANS search : unseenOnly et requirePhone restent appliqués (liste normale)", () => {
    const { sql } = buildFilterWhere({ unseenOnly: true, requirePhone: true });
    expect(sql).toContain("last_visited IS NULL");
    expect(sql).toContain("e.best_phone_e164 IS NOT NULL");
  });
});
