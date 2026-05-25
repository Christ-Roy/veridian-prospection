/**
 * Schéma + helpers ICP refill leads.
 *
 * Définit le shape canonique de `filters` envoyé :
 *  - du client UI → `POST /api/leads/estimate-count` (preview live count)
 *  - du client UI → `POST /api/refill/start` (création checkout)
 *  - du Hub (dispatcher webhook) → `POST /api/tenants/{id}/credit-leads`
 *    avec `filters` v2.1 — Prosp génère le lot matchant.
 *
 * Toutes les frontières (UI, app→Hub, Hub→app) valident contre CE schéma.
 * Si vous ajoutez un champ : modifier UNIQUEMENT ici, les 3 routes le
 * reflèteront automatiquement.
 *
 * Décisions :
 *  - `country` est figé à 'FR' pour l'instant (base entreprises 100% FR).
 *    Champ exposé pour préparer une expansion ultérieure (BE, CH, …).
 *  - `qualifiers` ne contient que les flags ICP business pertinents pour
 *    Prosp v1. La whitelist est centralisée dans QUALIFIER_KEYS.
 *  - `regions` accepte des numéros de département (2 chars, FR uniquement
 *    aujourd'hui). Validation : 2 chiffres OU "2A"/"2B" (Corse). Accepte
 *    aussi un slug zone ("idf", "ara") via le helper `expandZoneSlug`.
 */

import { z } from "zod";

// ─── Catalogues figés (whitelist) ─────────────────────────────────────────

/**
 * Codes département FR (zones métropole + DOM). 2 chars sauf Corse 2A/2B.
 * Liste exhaustive pour valider l'input — la base entreprises stocke
 * `departement` sur 2/3 chars compatibles avec cette liste.
 */
export const FR_DEPARTMENTS: readonly string[] = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "2A", "2B",
  "21", "22", "23", "24", "25", "26", "27", "28", "29",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
  "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "50", "51", "52", "53", "54", "55", "56", "57", "58", "59",
  "60", "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "70", "71", "72", "73", "74", "75", "76", "77", "78", "79",
  "80", "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "90", "91", "92", "93", "94", "95",
  "971", "972", "973", "974", "976",
];

/**
 * Presets régionaux exposés à l'UI. Le slug est ce que l'utilisateur clique,
 * la valeur est la liste de départements résolus. Modifier ici = la liste
 * change instantanément côté preview + checkout (zéro duplication).
 */
export const REGION_PRESETS: Record<string, readonly string[]> = {
  idf: ["75", "77", "78", "91", "92", "93", "94", "95"],
  ara: ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
  paca: ["04", "05", "06", "13", "83", "84"],
  occitanie: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
  hauts_de_france: ["02", "59", "60", "62", "80"],
  bretagne: ["22", "29", "35", "56"],
  pays_de_la_loire: ["44", "49", "53", "72", "85"],
  // Corse, DOM, etc. — extension future. Pas de "all" : "all" = filtre absent.
};

/**
 * Codes effectifs SIRENE (INSEE) — 9 tranches officielles + "00" (0 salarié).
 * Source : Code Officiel Géographique INSEE.
 *
 *  NN : 0 salariés
 *  00 : 0 salariés (autre code, certaines DB)
 *  01 : 1-2 salariés
 *  02 : 3-5
 *  03 : 6-9
 *  11 : 10-19
 *  12 : 20-49
 *  21 : 50-99
 *  22 : 100-199
 *  31 : 200-249
 *  32 : 250-499
 *  41 : 500-999
 *  42 : 1000-1999
 *  51 : 2000-4999
 *  52 : 5000-9999
 *  53 : 10000+
 */
export const SIRENE_EFFECTIF_CODES: readonly string[] = [
  "NN", "00",
  "01", "02", "03",
  "11", "12",
  "21", "22",
  "31", "32",
  "41", "42",
  "51", "52", "53",
];

/**
 * Mapping tranche effectifs → bornes [min, max] (max = null = open-ended).
 * Permet de convertir un slider numérique (5 à 50) en liste de codes.
 */
export const EFFECTIF_RANGES: Record<string, { min: number; max: number | null }> = {
  NN: { min: 0, max: 0 },
  "00": { min: 0, max: 0 },
  "01": { min: 1, max: 2 },
  "02": { min: 3, max: 5 },
  "03": { min: 6, max: 9 },
  "11": { min: 10, max: 19 },
  "12": { min: 20, max: 49 },
  "21": { min: 50, max: 99 },
  "22": { min: 100, max: 199 },
  "31": { min: 200, max: 249 },
  "32": { min: 250, max: 499 },
  "41": { min: 500, max: 999 },
  "42": { min: 1000, max: 1999 },
  "51": { min: 2000, max: 4999 },
  "52": { min: 5000, max: 9999 },
  "53": { min: 10000, max: 100_000 },
};

/**
 * Qualifiers ICP — tags premium activables sur plan business.
 * Whitelist fermée : si un nouveau flag arrive côté base entreprises, on
 * l'ajoute ici + dans le mapping SQL côté `buildIcpWhereSql` ci-dessous.
 */
export const QUALIFIER_KEYS = [
  "has_website",
  "no_website",
  "rge",
  "qualiopi",
  "bio",
  "epv",
  "ess",
  "marches_publics",
  "with_phone",
  "with_email",
  "auto_entrepreneur",
] as const;
export type QualifierKey = (typeof QUALIFIER_KEYS)[number];

// ─── Schéma Zod ICP filters ───────────────────────────────────────────────

/**
 * Sectors : codes NAF (5 chars FR : "56.10A") OU slugs métier pré-définis
 * ("restauration", "tech", "btp", "services_b2b", "industrie", "retail").
 *
 * La résolution slug → codes NAF se fait côté `buildIcpWhereSql` (helper
 * SQL builder) à partir de SECTOR_NAF_PRESETS.
 */
export const SECTOR_PRESETS: Record<string, readonly string[]> = {
  // Codes NAF FR officiels — pertinents pour B2B / commerce / artisanat
  restauration: ["56.10A", "56.10B", "56.10C", "56.21Z", "56.29A", "56.29B", "56.30Z"],
  hebergement: ["55.10Z", "55.20Z", "55.30Z", "55.90Z"],
  btp: [
    "41.10A", "41.10B", "41.10C", "41.10D",
    "41.20A", "41.20B",
    "42.11Z", "42.12Z", "42.13A", "42.13B",
    "43.11Z", "43.12A", "43.12B", "43.13Z",
    "43.21A", "43.21B", "43.22A", "43.22B", "43.29A", "43.29B",
    "43.31Z", "43.32A", "43.32B", "43.32C", "43.33Z", "43.34Z", "43.39Z",
    "43.91A", "43.91B", "43.99A", "43.99B", "43.99C", "43.99D", "43.99E",
  ],
  tech: [
    "62.01Z", "62.02A", "62.02B", "62.03Z", "62.09Z",
    "63.11Z", "63.12Z",
    "58.21Z", "58.29A", "58.29B", "58.29C",
  ],
  retail: [
    "47.11A", "47.11B", "47.11C", "47.11D", "47.11E", "47.11F",
    "47.19A", "47.19B",
    "47.21Z", "47.22Z", "47.23Z", "47.24Z", "47.25Z", "47.26Z", "47.29Z",
    "47.71Z", "47.72A", "47.72B", "47.73Z", "47.74Z", "47.75Z",
    "47.91A", "47.91B",
  ],
  services_b2b: [
    "69.10Z", "69.20Z",
    "70.21Z", "70.22Z",
    "73.11Z", "73.12Z", "73.20Z",
    "74.10Z", "74.20Z", "74.30Z", "74.90A", "74.90B",
  ],
  industrie: [
    "10.11Z", "10.12Z", "10.13A", "10.13B",
    "20.41Z", "20.42Z",
    "25.11Z", "25.12Z", "25.61Z", "25.62A", "25.62B",
    "28.11Z", "28.99A", "28.99B",
    "32.50A", "32.50B",
  ],
  sante: [
    "86.10Z", "86.21Z", "86.22A", "86.22B", "86.22C", "86.23Z",
    "86.90A", "86.90B", "86.90C", "86.90D", "86.90E", "86.90F",
    "87.10A", "87.10B", "87.10C",
    "88.10A", "88.10B", "88.10C",
  ],
};

const NafCodeSchema = z
  .string()
  .min(2)
  .max(8)
  // NAF FR : 5 chars + 1 lettre (ex "56.10A") OU 4 chars + 1 lettre.
  // On accepte aussi un préfixe court ("56" — section). Validation laxe :
  // alphanumérique + point uniquement.
  .regex(/^[0-9]{1,2}(\.[0-9]{1,2}[A-Z]?)?$/i, {
    message: "Invalid NAF code (expected like '56' or '56.10' or '56.10A')",
  });

const DepartementSchema = z
  .string()
  .refine((v) => FR_DEPARTMENTS.includes(v.toUpperCase()), {
    message: "Invalid FR department code",
  });

const SectorSchema = z.union([
  NafCodeSchema,
  z.enum(Object.keys(SECTOR_PRESETS) as [string, ...string[]]),
]);

const EmployeeRangeSchema = z.object({
  min: z.number().int().min(0).max(100_000).optional(),
  max: z.number().int().min(0).max(100_000).optional(),
}).refine(
  (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
  { message: "employee_range.min must be ≤ max" },
);

const RevenueRangeSchema = z.object({
  // Chiffre d'affaires EN EUROS. Anti-input absurde : max 100M€.
  min: z.number().int().min(0).max(100_000_000_000).optional(),
  max: z.number().int().min(0).max(100_000_000_000).optional(),
}).refine(
  (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
  { message: "revenue_range.min must be ≤ max" },
);

const AgeRangeSchema = z.object({
  min_years: z.number().int().min(0).max(150).optional(),
  max_years: z.number().int().min(0).max(150).optional(),
}).refine(
  (v) => v.min_years === undefined || v.max_years === undefined || v.min_years <= v.max_years,
  { message: "age_range.min_years must be ≤ max_years" },
);

export const RefillIcpFiltersSchema = z
  .object({
    country: z.literal("FR").default("FR"),
    regions: z.array(DepartementSchema).max(101).optional(),
    sectors: z.array(SectorSchema).max(50).optional(),
    employee_range: EmployeeRangeSchema.optional(),
    revenue_range: RevenueRangeSchema.optional(),
    age_range: AgeRangeSchema.optional(),
    qualifiers: z.array(z.enum(QUALIFIER_KEYS)).max(QUALIFIER_KEYS.length).optional(),
  })
  .strict();

export type RefillIcpFilters = z.infer<typeof RefillIcpFiltersSchema>;

// ─── SQL builder pour estimate-count + génération lot ────────────────────

/**
 * Construit le bloc WHERE SQL pour la table `entreprises` à partir des
 * filtres ICP. Pure : pas de side-effect, pas d'accès DB.
 *
 * Sécurité : tous les inputs sont injectés via le tableau `params` retourné
 * — JAMAIS interpolés dans la string SQL. Le caller utilise `$queryRawUnsafe`
 * + spread du tableau pour binding paramétré Postgres.
 *
 * Retourne :
 *  - `sql`     : le bloc " AND (...)" à concaténer après le WHERE de base.
 *               Empty string si aucun filtre actif.
 *  - `params`  : valeurs à binder en positionnel (`$1`, `$2`, …).
 *  - `startIndex` : index du PROCHAIN paramètre disponible (le caller peut
 *               continuer à builder son SQL en réutilisant cet offset).
 */
export function buildIcpWhereSql(
  filters: RefillIcpFilters,
  startIndex: number = 1,
): { sql: string; params: (string | number)[]; nextIndex: number } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  let idx = startIndex;

  // ─── Country (FR uniquement aujourd'hui) ───
  // Pas de colonne `country` dans entreprises (table 100% FR). Si on étend
  // un jour, on ajoutera un filtre ici. Pour l'instant `country !== 'FR'` =
  // résultat vide.
  if (filters.country !== "FR") {
    clauses.push("FALSE");
  }

  // ─── Régions (départements) ───
  if (filters.regions && filters.regions.length > 0) {
    const placeholders = filters.regions
      .map((dep) => {
        params.push(dep.toUpperCase());
        return `$${idx++}`;
      })
      .join(",");
    clauses.push(`e.departement IN (${placeholders})`);
  }

  // ─── Secteurs (NAF + presets slug) ───
  if (filters.sectors && filters.sectors.length > 0) {
    const nafCodes = expandSectorsToNaf(filters.sectors);
    if (nafCodes.length > 0) {
      const placeholders = nafCodes
        .map((code) => {
          params.push(code);
          return `$${idx++}`;
        })
        .join(",");
      clauses.push(`e.code_naf IN (${placeholders})`);
    } else {
      // Si la liste se résout à rien (slugs inconnus) → résultat vide.
      clauses.push("FALSE");
    }
  }

  // ─── Tranche d'effectifs (range numérique → liste de codes SIRENE) ───
  if (filters.employee_range) {
    const codes = resolveEmployeeRangeToCodes(
      filters.employee_range.min,
      filters.employee_range.max,
    );
    if (codes.length > 0) {
      const placeholders = codes
        .map((c) => {
          params.push(c);
          return `$${idx++}`;
        })
        .join(",");
      clauses.push(`e.tranche_effectifs IN (${placeholders})`);
    } else {
      clauses.push("FALSE");
    }
  }

  // ─── Chiffre d'affaires ───
  if (filters.revenue_range) {
    if (typeof filters.revenue_range.min === "number") {
      params.push(filters.revenue_range.min);
      clauses.push(`e.chiffre_affaires >= $${idx++}`);
    }
    if (typeof filters.revenue_range.max === "number") {
      params.push(filters.revenue_range.max);
      clauses.push(`e.chiffre_affaires <= $${idx++}`);
    }
  }

  // ─── Âge entreprise (date_creation vs CURRENT_DATE) ───
  if (filters.age_range) {
    if (typeof filters.age_range.min_years === "number") {
      params.push(filters.age_range.min_years);
      clauses.push(
        `e.date_creation IS NOT NULL AND ` +
          `EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.date_creation))::int >= $${idx++}`,
      );
    }
    if (typeof filters.age_range.max_years === "number") {
      params.push(filters.age_range.max_years);
      clauses.push(
        `e.date_creation IS NOT NULL AND ` +
          `EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.date_creation))::int <= $${idx++}`,
      );
    }
  }

  // ─── Qualifiers (flags booléens) ───
  if (filters.qualifiers && filters.qualifiers.length > 0) {
    for (const q of filters.qualifiers) {
      const clause = QUALIFIER_SQL[q];
      if (clause) clauses.push(clause);
    }
  }

  const sql = clauses.length > 0 ? ` AND (${clauses.join(" AND ")})` : "";
  return { sql, params, nextIndex: idx };
}

/** Convertit slug presets ("tech", "btp") + codes NAF mixtes vers liste plate de codes NAF. */
function expandSectorsToNaf(sectors: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of sectors) {
    if (s in SECTOR_PRESETS) {
      for (const code of SECTOR_PRESETS[s]) out.add(code);
    } else {
      out.add(s.toUpperCase());
    }
  }
  return Array.from(out);
}

/** Résout un range numérique d'employés → liste de codes SIRENE qui chevauchent. */
function resolveEmployeeRangeToCodes(
  min: number | undefined,
  max: number | undefined,
): string[] {
  const lo = min ?? 0;
  const hi = max ?? 100_000;
  const out: string[] = [];
  for (const [code, range] of Object.entries(EFFECTIF_RANGES)) {
    const rMin = range.min;
    const rMax = range.max ?? Number.POSITIVE_INFINITY;
    // Overlap [rMin, rMax] ∩ [lo, hi] non vide.
    if (rMax >= lo && rMin <= hi) out.push(code);
  }
  return out;
}

/**
 * SQL booléen par qualifier — pas de paramètre à binder (clauses statiques).
 * Si on ajoute un qualifier dans QUALIFIER_KEYS, on doit ajouter une entrée
 * ici sinon il sera silencieusement ignoré (typage TS protège partiellement).
 */
const QUALIFIER_SQL: Record<QualifierKey, string> = {
  has_website: "(e.web_domain_normalized IS NOT NULL OR e.web_domain IS NOT NULL)",
  no_website: "(e.web_domain_normalized IS NULL AND e.web_domain IS NULL)",
  rge: "e.est_rge = true",
  qualiopi: "e.est_qualiopi = true",
  bio: "e.est_bio = true",
  epv: "e.est_epv = true",
  ess: "e.est_ess = true",
  marches_publics: "COALESCE(e.nb_marches_publics, 0) > 0",
  with_phone: "e.best_phone_e164 IS NOT NULL",
  with_email: "e.best_email_normalized IS NOT NULL",
  auto_entrepreneur: "e.is_auto_entrepreneur = true",
};

/**
 * Helper : étend un slug de zone régionale en liste de départements.
 * Utilisé par l'UI pour matérialiser un preset ("idf") en chips visibles.
 */
export function expandZoneSlug(slug: string): readonly string[] | null {
  return REGION_PRESETS[slug] ?? null;
}
