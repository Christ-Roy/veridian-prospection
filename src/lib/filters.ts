/**
 * Moteur de filtres configurable pour le dashboard de prospection.
 *
 * 4 filtres indépendants :
 * 1. Qualité lead (Or/Argent/Bronze) — basé sur la qualité des données
 * 2. Secteur NAF — du plus strict au plus large
 * 3. Taille entreprise — Individuel/PME/Grande avec min/max
 * 4. Tech debt — pour le tri (score existant tech_score)
 *
 * Tous les seuils sont configurables via la page Settings (pipeline_config).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type QualityTier = "or" | "argent" | "bronze" | "historique";

export interface QualityConfig {
  /** Or : données complètes, on peut appeler direct */
  or: {
    requireEnrichedSiren: boolean;
    requirePhone: boolean;
    requireNaf: boolean;
    requireEffectifs: boolean;
  };
  /** Argent : enrichi mais données partielles */
  argent: {
    requireEnriched: boolean; // siren OR name_cp
    requirePhoneOrEmail: boolean;
    excludeExcluded: boolean;
  };
  /** Bronze : a un signal minimum mais pas enrichi proprement */
  bronze: {
    requireAnyContact: boolean; // phone OR email OR siret
    excludeExcluded: boolean;
  };
}

export interface SizeConfig {
  mode: "individuel" | "pme" | "grande" | "all";
  /** Opérateur pour combiner effectifs et CA : "and" | "or" */
  operator: "and" | "or";
  effectifsMin: number | null;
  effectifsMax: number | null;
  caMin: number | null;
  caMax: number | null;
}

export interface NafStrictness {
  level: "ultra_strict" | "strict" | "large" | "all";
  /** Codes NAF custom (override les presets si non vide) */
  customCodes: string[];
}

export interface TechDebtConfig {
  /** Score minimum pour afficher (en dessous = pas chargé) */
  minScore: number;
  /** Score "éclaté au sol" (priorité max) */
  eclateSeuil: number;
}

export interface FilterConfig {
  quality: QualityConfig;
  size: SizeConfig;
  naf: NafStrictness;
  techDebt: TechDebtConfig;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  or: {
    requireEnrichedSiren: true,
    requirePhone: true,
    requireNaf: true,
    requireEffectifs: false, // relaxé pour avoir ~15% du pool
  },
  argent: {
    requireEnriched: true,
    requirePhoneOrEmail: true,
    excludeExcluded: true,
  },
  bronze: {
    requireAnyContact: true,
    excludeExcluded: true,
  },
};

export const DEFAULT_SIZE_CONFIG: SizeConfig = {
  mode: "all",
  operator: "or",
  effectifsMin: null,
  effectifsMax: null,
  caMin: null,
  caMax: null,
};

export const DEFAULT_NAF_CONFIG: NafStrictness = {
  level: "all",
  customCodes: [],
};

export const DEFAULT_TECH_DEBT_CONFIG: TechDebtConfig = {
  minScore: 0,
  eclateSeuil: 30,
};

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  quality: DEFAULT_QUALITY_CONFIG,
  size: DEFAULT_SIZE_CONFIG,
  naf: DEFAULT_NAF_CONFIG,
  techDebt: DEFAULT_TECH_DEBT_CONFIG,
};

// ─── NAF Presets ─────────────────────────────────────────────────────────────

/** Top 23 codes NAF — meilleurs secteurs pour la vente de refontes web */
export const NAF_ULTRA_STRICT: string[] = [
  "86.21Z", "86.22A", "86.22B", "86.22C", "86.23Z", "86.90A", "86.90B",
  "86.90C", "86.90D", "86.90F",
  "69.10Z", "69.20Z",
  "96.02A", "96.02B", "96.04Z",
  "43.21A", "43.22A", "43.22B", "43.31Z", "43.32A", "43.32B", "43.32C",
  "43.33Z", "43.34Z", "43.91A", "43.91B", "43.99C", "43.11Z", "43.12A",
  "71.11Z", "71.12A", "71.12B", "71.20A", "71.20B",
  "68.20A", "68.20B", "68.31Z", "68.32A",
  "74.10Z",
  "56.21Z", "56.29A", "56.29B",
];

/** ~70 codes NAF — bons secteurs incluant les ultra-strict */
export const NAF_STRICT: string[] = [
  ...NAF_ULTRA_STRICT,
  "45.20A", "45.11Z", "45.32Z", "45.40Z",
  "47.73Z", "47.76Z", "47.71Z", "47.78C", "47.64Z", "47.59A",
  "55.10Z", "55.20Z",
  "85.59A", "85.51Z", "85.53Z",
  "93.12Z", "93.11Z", "93.13Z",
  "81.21Z", "81.30Z", "81.22Z", "81.29A",
  "62.01Z", "62.02A",
  "70.22Z", "70.21Z",
  "73.11Z",
  "82.11Z", "82.30Z",
  "56.10A", "56.10C",
];

// ─── Effectifs mapping (INSEE codes → nombre) ───────────────────────────────

export const EFFECTIFS_MAP: Record<string, { min: number; max: number; label: string }> = {
  "00": { min: 0, max: 0, label: "0 salarié" },
  "01": { min: 1, max: 2, label: "1-2 salariés" },
  "02": { min: 3, max: 5, label: "3-5 salariés" },
  "03": { min: 6, max: 9, label: "6-9 salariés" },
  "11": { min: 10, max: 19, label: "10-19 salariés" },
  "12": { min: 20, max: 49, label: "20-49 salariés" },
  "21": { min: 50, max: 99, label: "50-99 salariés" },
  "22": { min: 100, max: 199, label: "100-199 salariés" },
  "31": { min: 200, max: 249, label: "200-249 salariés" },
  "32": { min: 250, max: 499, label: "250-499 salariés" },
  "41": { min: 500, max: 999, label: "500-999 salariés" },
  "42": { min: 1000, max: 1999, label: "1 000-1 999 salariés" },
  "51": { min: 2000, max: 4999, label: "2 000-4 999 salariés" },
  "52": { min: 5000, max: 9999, label: "5 000-9 999 salariés" },
  "53": { min: 10000, max: 999999, label: "10 000+ salariés" },
  "NN": { min: -1, max: -1, label: "Non renseigné" },
};

/** Labels CA lisibles */
export function formatCA(ca: number | null): string {
  if (ca === null || ca === 0) return "Non renseigné";
  if (ca < 100_000) return `${Math.round(ca / 1000)}K €`;
  if (ca < 1_000_000) return `${Math.round(ca / 1000)}K €`;
  return `${(ca / 1_000_000).toFixed(1)}M €`;
}

/** Label effectifs depuis code INSEE */
export function formatEffectifs(code: string | null): string {
  if (!code) return "Non renseigné";
  return EFFECTIFS_MAP[code]?.label ?? "Non renseigné";
}

// ─── SQL WHERE builders ──────────────────────────────────────────────────────

/**
 * Construit la clause WHERE pour le filtre qualité (Or/Argent/Bronze).
 * Retourne le SQL fragment et les params.
 */
export function buildQualityWhere(
  tier: QualityTier,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG
): string {
  const notExcluded = "(r.niveau IS NULL OR r.niveau NOT IN ('excluded','redflag'))";

  switch (tier) {
    case "or": {
      const clauses = [notExcluded];
      if (config.or.requireEnrichedSiren) clauses.push("r.enriched_via = 'siren'");
      if (config.or.requirePhone) clauses.push("r.phone_principal IS NOT NULL AND r.phone_principal != ''");
      if (config.or.requireNaf) clauses.push("r.api_code_naf IS NOT NULL");
      if (config.or.requireEffectifs) clauses.push("r.api_effectifs IS NOT NULL AND r.api_effectifs != '' AND r.api_effectifs != 'NN'");
      return clauses.join(" AND ");
    }
    case "argent": {
      const clauses = [notExcluded];
      if (config.argent.requireEnriched) clauses.push("r.enriched_via IN ('siren','name_cp')");
      if (config.argent.requirePhoneOrEmail) {
        clauses.push("((r.phone_principal IS NOT NULL AND r.phone_principal != '') OR (r.email_principal IS NOT NULL AND r.email_principal != ''))");
      }
      // Exclure les Or pour ne pas les compter deux fois
      clauses.push("NOT (" + buildQualityWhere("or", config) + ")");
      return clauses.join(" AND ");
    }
    case "bronze": {
      const clauses = [notExcluded];
      if (config.bronze.requireAnyContact) {
        clauses.push("((r.phone_principal IS NOT NULL AND r.phone_principal != '') OR (r.email_principal IS NOT NULL AND r.email_principal != '') OR (r.siret IS NOT NULL AND r.siret != ''))");
      }
      // Exclure Or et Argent
      clauses.push("NOT (" + buildQualityWhere("or", config) + ")");
      const argentBase = [notExcluded];
      if (config.argent.requireEnriched) argentBase.push("r.enriched_via IN ('siren','name_cp')");
      if (config.argent.requirePhoneOrEmail) {
        argentBase.push("((r.phone_principal IS NOT NULL AND r.phone_principal != '') OR (r.email_principal IS NOT NULL AND r.email_principal != ''))");
      }
      clauses.push("NOT (" + argentBase.join(" AND ") + ")");
      return clauses.join(" AND ");
    }
    case "historique":
      return "o.last_visited IS NOT NULL";
  }
}

/**
 * Construit la clause WHERE pour le filtre taille entreprise.
 */
export function buildSizeWhere(config: SizeConfig = DEFAULT_SIZE_CONFIG): string | null {
  const clauses: string[] = [];

  // Mode prédéfini
  switch (config.mode) {
    case "individuel":
      clauses.push("(r.api_effectifs IN ('00','01') OR r.api_forme_juridique LIKE '%EI%' OR r.api_forme_juridique LIKE '%auto%')");
      break;
    case "pme":
      clauses.push("r.api_effectifs IN ('02','03','11','12','21','22','31')");
      break;
    case "grande":
      clauses.push("r.api_effectifs IN ('32','41','42','51','52','53')");
      break;
    case "all":
      break;
  }

  // Min/max effectifs
  const effClauses: string[] = [];
  if (config.effectifsMin !== null) {
    const codes = Object.entries(EFFECTIFS_MAP)
      .filter(([, v]) => v.max >= config.effectifsMin!)
      .map(([k]) => `'${k}'`);
    if (codes.length > 0) effClauses.push(`r.api_effectifs IN (${codes.join(",")})`);
  }
  if (config.effectifsMax !== null) {
    const codes = Object.entries(EFFECTIFS_MAP)
      .filter(([, v]) => v.min <= config.effectifsMax! && v.min >= 0)
      .map(([k]) => `'${k}'`);
    if (codes.length > 0) effClauses.push(`r.api_effectifs IN (${codes.join(",")})`);
  }

  // Min/max CA
  const caClauses: string[] = [];
  if (config.caMin !== null) caClauses.push(`r.api_ca >= ${config.caMin}`);
  if (config.caMax !== null) caClauses.push(`r.api_ca <= ${config.caMax}`);

  // Combiner effectifs et CA avec l'opérateur choisi
  const combined: string[] = [];
  if (effClauses.length > 0) combined.push("(" + effClauses.join(" AND ") + ")");
  if (caClauses.length > 0) combined.push("(" + caClauses.join(" AND ") + ")");

  if (combined.length > 0) {
    const op = config.operator === "and" ? " AND " : " OR ";
    clauses.push("(" + combined.join(op) + ")");
  }

  return clauses.length > 0 ? clauses.join(" AND ") : null;
}

/**
 * Construit la clause WHERE pour le filtre NAF.
 */
export function buildNafWhere(config: NafStrictness = DEFAULT_NAF_CONFIG): string | null {
  let codes: string[];

  if (config.customCodes.length > 0) {
    codes = config.customCodes;
  } else {
    switch (config.level) {
      case "ultra_strict":
        codes = NAF_ULTRA_STRICT;
        break;
      case "strict":
        codes = NAF_STRICT;
        break;
      case "large":
      case "all":
        return null; // Pas de filtre
    }
  }

  const exact = codes.filter((c) => c.length >= 5).map((c) => `'${c}'`);
  const prefixes = codes.filter((c) => c.length < 5);

  const parts: string[] = [];
  if (exact.length > 0) parts.push(`r.api_code_naf IN (${exact.join(",")})`);
  for (const p of prefixes) {
    parts.push(`r.api_code_naf LIKE '${p}%'`);
  }

  return parts.length > 0 ? "(" + parts.join(" OR ") + ")" : null;
}

/**
 * Construit la clause WHERE tech debt minimum.
 */
export function buildTechDebtWhere(config: TechDebtConfig = DEFAULT_TECH_DEBT_CONFIG): string | null {
  if (config.minScore > 0) {
    return `r.tech_score >= ${config.minScore}`;
  }
  return null;
}

/**
 * Combine tous les filtres en une seule clause WHERE.
 */
export function buildFullWhere(
  tier: QualityTier,
  config: FilterConfig = DEFAULT_FILTER_CONFIG,
  extraWhere?: string
): string {
  const parts: string[] = [];

  parts.push(buildQualityWhere(tier, config.quality));

  const sizeWhere = buildSizeWhere(config.size);
  if (sizeWhere) parts.push(sizeWhere);

  const nafWhere = buildNafWhere(config.naf);
  if (nafWhere) parts.push(nafWhere);

  const techWhere = buildTechDebtWhere(config.techDebt);
  if (techWhere) parts.push(techWhere);

  if (extraWhere) parts.push(extraWhere);

  return parts.join(" AND ");
}
