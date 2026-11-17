/**
 * Requêtes SQL libres de l'accès avancé (16/11, Robert : « des accès pour les clients très proches »).
 * Deux barrières : ce garde (une seule lecture SELECT/WITH, sur les vues d'ODH autorisées, résultat
 * borné), puis le compte ClickHouse prospection_ro lui-même (lecture seule, 10 s, 15 M lignes lues, ni URL
 * ni fichier : vu refuser `url()` le 16/11). Le garde n'a pas à être parfait, il doit refuser tôt et lisiblement.
 */
import { FiltreInvalide } from "./filtres";

export const TABLES_SQL = [
  "odh.company_prospection_current",
  "odh.company_master_current",
  "odh.market_cube_current",
  // Pile logicielle (ODH-0263, 17/11) : par SIREN, par domaine avec la preuve, ce qui a été examiné, et le cube par outil.
  "odh.company_tech_stack_current",
  "odh.web_tech_stack_current",
  "odh.web_tech_stack_checked",
  "odh.market_cube_tech_current",
] as const;
export const LIGNES_MAX_SQL = 1000;

const INTERDITS = /\b(settings|format|outfile|insert|alter|drop|create|attach|detach|kill|system|optimize|truncate|grant|revoke|rename|exchange|undrop|set|use|delete|update)\b/i;

/** Retire les chaînes entre apostrophes pour que leur contenu ne déclenche ni ne masque rien. */
function sansChaines(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

/**
 * Valide une requête et la rend bornée : `SELECT * FROM (<requête>) LIMIT n`. Lève FiltreInvalide avec la
 * raison, en clair, pour que l'IA corrige d'elle-même.
 */
export function verifierRequete(brut: string, limite = LIGNES_MAX_SQL): string {
  const q = brut.trim().replace(/;\s*$/, "");
  if (!q) throw new FiltreInvalide("requête vide");
  if (q.length > 8000) throw new FiltreInvalide("requête trop longue (8 000 caractères au plus)");
  // EXTRACT(YEAR FROM d), TRIM(BOTH ' ' FROM x)… : leur FROM n'est pas une table.
  const nu = sansChaines(q).replace(/\b(extract|trim|substring|position|overlay)\s*\([^()]*\)/gi, "$1()");
  if (/;/.test(nu)) throw new FiltreInvalide("une seule requête à la fois");
  if (/--|\/\*|#!|\\G/.test(nu)) throw new FiltreInvalide("commentaires refusés");
  if (!/^\s*(select|with)\b/i.test(nu)) throw new FiltreInvalide("lecture seule : la requête commence par SELECT ou WITH");
  const mot = nu.match(INTERDITS);
  if (mot) throw new FiltreInvalide(`mot refusé : ${mot[1].toUpperCase()} (lecture seule, sans réglage ni format)`);
  // Noms des sous-requêtes nommées (WITH x AS (…)), utilisables comme tables.
  const ctes = new Set([...nu.matchAll(/(?:\bwith|,)\s*([a-z_][\w]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const tables = new Set<string>(TABLES_SQL);
  const sources = [
    ...[...nu.matchAll(/\b(?:from|join)\s+([`"\w.]+)/gi)].map((m) => m[1]),
    // jointure par virgule : FROM a [AS x], b
    ...[...nu.matchAll(/\bfrom\s+[`"\w.]+(?:\s+(?:as\s+)?\w+)?\s*,\s*([`"\w.]+)/gi)].map((m) => m[1]),
  ];
  for (const s of sources) {
    const nom = s.replace(/[`"]/g, "").toLowerCase();
    if (!tables.has(nom) && !ctes.has(nom)) {
      throw new FiltreInvalide(`table « ${nom} » non autorisée : ${TABLES_SQL.join(", ")} (ou une sous-requête)`);
    }
  }
  if (!sources.length) throw new FiltreInvalide(`la requête lit une table : ${TABLES_SQL.join(", ")}`);
  const n = Math.min(LIGNES_MAX_SQL, Math.max(1, Math.trunc(limite)));
  return `SELECT * FROM (\n${q}\n) LIMIT ${n}`;
}
