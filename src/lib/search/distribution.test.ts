import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke l'exécution DB : withSearchTimeout(fn) appelle fn avec un runner `q`
// espionné. On capture les SQL générés pour vérifier la whitelist + le binding,
// et on renvoie des lignes factices pour couvrir le chemin de transformation.
const capturedSql: string[] = [];
const capturedParams: unknown[][] = [];
let queueRows: unknown[][] = [];

vi.mock("./exec", () => ({
  withSearchTimeout: async (fn: (q: (sql: string, ...p: unknown[]) => Promise<unknown>) => Promise<unknown>) => {
    const q = async (sql: string, ...params: unknown[]) => {
      capturedSql.push(sql);
      capturedParams.push(params);
      return queueRows.shift() ?? [];
    };
    return fn(q);
  },
  isStatementTimeout: () => false,
}));

// Import APRÈS le mock (distribution.ts importe withSearchTimeout).
import {
  DistributionRequestSchema,
  DistributionValidationError,
  computeDistribution,
} from "./distribution";

beforeEach(() => {
  capturedSql.length = 0;
  capturedParams.length = 0;
  queueRows = [];
});

describe("DistributionRequestSchema — validation du body", () => {
  it("exige group_by OU metric", () => {
    const r = DistributionRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("refuse group_by ET metric ensemble (exclusifs)", () => {
    const r = DistributionRequestSchema.safeParse({ group_by: "secteur_final", metric: "chiffre_affaires" });
    expect(r.success).toBe(false);
  });

  it("accepte un group_by seul", () => {
    const r = DistributionRequestSchema.safeParse({ group_by: "ecom_platform" });
    expect(r.success).toBe(true);
  });

  it("accepte un metric seul avec buckets/top", () => {
    const r = DistributionRequestSchema.safeParse({ metric: "chiffre_affaires", buckets: 12 });
    expect(r.success).toBe(true);
  });

  it("rejette un champ supplémentaire inconnu (strict)", () => {
    const r = DistributionRequestSchema.safeParse({ group_by: "secteur_final", evil: 1 });
    expect(r.success).toBe(false);
  });

  it("valide les filtres de contexte via SearchFiltersSchema (champ inconnu rejeté)", () => {
    const r = DistributionRequestSchema.safeParse({
      group_by: "secteur_final",
      filters: { all: [{ field: "siren; DROP TABLE entreprises;--", op: "eq", value: "x" }] },
    });
    expect(r.success).toBe(false);
  });
});

describe("computeDistribution — group_by catégoriel", () => {
  it("rejette un champ inconnu (anti-injection : jamais l'input en colonne)", async () => {
    await expect(
      computeDistribution({ group_by: "e.foo; DROP TABLE entreprises" } as never),
    ).rejects.toBeInstanceOf(DistributionValidationError);
  });

  it("rejette group_by sur un champ numérique et guide vers metric", async () => {
    await expect(computeDistribution({ group_by: "chiffre_affaires" })).rejects.toThrow(/metric/);
  });

  it("génère un GROUP BY sur la colonne WHITELISTÉE, jamais l'input", async () => {
    queueRows = [
      [
        { key: "woocommerce", count: BigInt(100), with_phone: BigInt(60), with_email: BigInt(40) },
        { key: "shopify", count: BigInt(30), with_phone: BigInt(20), with_email: BigInt(25) },
      ],
    ];
    const res = await computeDistribution({ group_by: "ecom_platform", top: 5 });
    expect(res.mode).toBe("group_by");
    // La colonne vient de FIELD_CATALOG.ecom_platform.sql = "e.ecom_platform".
    expect(capturedSql[0]).toContain("e.ecom_platform");
    expect(capturedSql[0]).toContain("GROUP BY 1");
    expect(capturedSql[0]).toContain("LIMIT 5");
    // Le nom "ecom_platform" (clé) n'apparaît jamais brut comme identifiant SQL.
    expect(capturedSql[0]).not.toMatch(/DROP|;--/);
    if (res.mode === "group_by") {
      expect(res.buckets).toHaveLength(2);
      expect(res.buckets[0]).toMatchObject({ key: "woocommerce", count: 100, with_phone: 60, with_email: 40 });
      expect(res.total).toBe(130);
    }
  });

  it("borne le top entre 1 et 100", async () => {
    queueRows = [[]];
    const res = await computeDistribution({ group_by: "secteur_final", top: 9999 });
    if (res.mode === "group_by") expect(res.top).toBe(100);
    expect(capturedSql[0]).toContain("LIMIT 100");
  });

  it("COALESCE les NULL en '(inconnu)'", async () => {
    queueRows = [[{ key: null, count: BigInt(5), with_phone: BigInt(1), with_email: BigInt(2) }]];
    const res = await computeDistribution({ group_by: "web_cms" });
    expect(capturedSql[0]).toContain("'(inconnu)'");
    if (res.mode === "group_by") expect(res.buckets[0].key).toBe("(inconnu)");
  });
});

describe("computeDistribution — metric numérique (percentiles + histogramme)", () => {
  it("rejette metric sur un champ texte et guide vers group_by", async () => {
    await expect(computeDistribution({ metric: "secteur_final" })).rejects.toThrow(/group_by/);
  });

  it("rejette metric sur un champ inconnu", async () => {
    await expect(computeDistribution({ metric: "nope_invalide" })).rejects.toBeInstanceOf(
      DistributionValidationError,
    );
  });

  it("calcule stats + histogramme, min/max bindés en params ($n)", async () => {
    // Passe 1 : stats. Passe 2 : bins width_bucket.
    queueRows = [
      [{ count: BigInt(1000), min: 0, max: 1000, avg: 400, median: 350, p25: 100, p75: 600, p90: 900 }],
      [
        { bucket: 1, count: BigInt(500) },
        { bucket: 2, count: BigInt(300) },
        { bucket: 10, count: BigInt(200) },
      ],
    ];
    const res = await computeDistribution({ metric: "chiffre_affaires", buckets: 10 });
    expect(res.mode).toBe("metric");

    // Passe stats : PERCENTILE_CONT sur la colonne whitelistée.
    expect(capturedSql[0]).toContain("PERCENTILE_CONT");
    expect(capturedSql[0]).toContain("e.chiffre_affaires");

    // Passe histogramme : width_bucket, et min/max passés en params bindés
    // (pas de littéral 0/1000 injecté dans le SQL).
    expect(capturedSql[1]).toContain("width_bucket");
    const binParams = capturedParams[1];
    expect(binParams).toContain(0);
    expect(binParams).toContain(1000);
    // Le SQL référence les placeholders, pas les valeurs.
    expect(capturedSql[1]).toMatch(/\$\d+::float8/);

    if (res.mode === "metric") {
      expect(res.stats).toMatchObject({ count: 1000, min: 0, max: 1000, median: 350, p90: 900 });
      // Histogramme dense : 10 barres, même les vides (buckets 3..9 = 0).
      expect(res.histogram).toHaveLength(10);
      expect(res.histogram[0]).toMatchObject({ bucket: 1, from: 0, count: 500 });
      expect(res.histogram[9]).toMatchObject({ bucket: 10, to: 1000, count: 200 });
      expect(res.histogram[2].count).toBe(0); // bucket vide reconstruit
    }
  });

  it("borne buckets entre 3 et 30", async () => {
    queueRows = [
      [{ count: BigInt(10), min: 0, max: 100, avg: 50, median: 50, p25: 25, p75: 75, p90: 90 }],
      [],
    ];
    const res = await computeDistribution({ metric: "prospect_score", buckets: 999 });
    if (res.mode === "metric") expect(res.buckets).toBe(30);
  });

  it("gère un segment vide (count=0) sans planter l'histogramme", async () => {
    queueRows = [[{ count: BigInt(0), min: null, max: null, avg: null, median: null, p25: null, p75: null, p90: null }]];
    const res = await computeDistribution({ metric: "chiffre_affaires" });
    if (res.mode === "metric") {
      expect(res.stats.count).toBe(0);
      expect(res.histogram).toHaveLength(0);
      // Pas de 2e requête (pas d'histogramme à calculer).
      expect(capturedSql).toHaveLength(1);
    }
  });

  it("gère min==max (toutes valeurs identiques) → un seul bucket", async () => {
    queueRows = [[{ count: BigInt(42), min: 500, max: 500, avg: 500, median: 500, p25: 500, p75: 500, p90: 500 }]];
    const res = await computeDistribution({ metric: "chiffre_affaires" });
    if (res.mode === "metric") {
      expect(res.histogram).toHaveLength(1);
      expect(res.histogram[0]).toMatchObject({ from: 500, to: 500, count: 42 });
    }
  });
});

describe("computeDistribution — filtres de contexte", () => {
  it("applique les filtres en WHERE paramétré (valeur bindée, pas dans le SQL)", async () => {
    queueRows = [[]];
    await computeDistribution({
      group_by: "ecom_platform",
      filters: { all: [{ field: "ecom_level", op: "eq", value: "boutique" }] },
    });
    // La valeur "boutique" est bindée ($1), jamais concaténée dans le SQL.
    expect(capturedSql[0]).toContain("e.ecom_level = $1");
    expect(capturedSql[0]).not.toContain("boutique");
    expect(capturedParams[0]).toContain("boutique");
  });

  it("sans filtres, interroge tout le référentiel (défauts is_registrar/ca_suspect seuls)", async () => {
    queueRows = [[]];
    await computeDistribution({ group_by: "secteur_final" });
    expect(capturedSql[0]).toContain("e.is_registrar = false");
    expect(capturedParams[0]).toHaveLength(0);
  });
});
