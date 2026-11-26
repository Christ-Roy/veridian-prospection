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
  const sources = sourcesDe(nu);
  for (const { nom, fonction } of sources) {
    if (fonction) throw new FiltreInvalide(`fonction de table « ${nom} » refusée : lisez ${TABLES_SQL.join(", ")} (ou une sous-requête)`);
    if (!tables.has(nom) && !ctes.has(nom)) {
      throw new FiltreInvalide(`table « ${nom} » non autorisée : ${TABLES_SQL.join(", ")} (ou une sous-requête)`);
    }
  }
  if (!sources.length) throw new FiltreInvalide(`la requête lit une table : ${TABLES_SQL.join(", ")}`);
  const n = Math.min(LIGNES_MAX_SQL, Math.max(1, Math.trunc(limite)));
  return `SELECT * FROM (\n${q}\n) LIMIT ${n}`;
}

const FIN_SOURCES = /^(where|prewhere|group|order|limit|having|union|join|inner|left|right|full|cross|any|all|asof|semi|anti|array|global|on|using|final|sample|window|qualify|intersect|except|offset|format|settings)$/i;

/**
 * Toutes les sources d'une requête : chaque élément de chaque liste `FROM a [AS x], b, (…) y`, et chaque `JOIN t`.
 * Une sous-requête « (… ) » n'est pas une source (son contenu est lu par ailleurs) ; un nom suivi de « ( » est une
 * fonction de table (url, numbers, remote…). Le 26/11, seule la table suivant la 1re virgule était vue :
 * `FROM a, b, information_schema.tables` passait, comme une sous-requête nommée `url` puis `FROM url(…)`.
 */
function sourcesDe(sql: string): { nom: string; fonction: boolean }[] {
  const jetons = sql.match(/`[^`]*`|"[^"]*"|[\w.]+|\(|\)|,|\S/g) ?? [];
  const nomDe = (j: string) => j.replace(/[`"]/g, "").toLowerCase();
  const sortie: { nom: string; fonction: boolean }[] = [];
  const lireSource = (i: number): number => {
    // i pointe sur le premier jeton de la source ; rend l'indice qui suit la source (avant alias).
    if (jetons[i] === "(") {
      let p = 0;
      for (; i < jetons.length; i++) {
        if (jetons[i] === "(") p++;
        else if (jetons[i] === ")" && --p === 0) return i + 1;
      }
      return i;
    }
    if (i < jetons.length) sortie.push({ nom: nomDe(jetons[i]), fonction: jetons[i + 1] === "(" });
    return i + 1;
  };
  for (let i = 0; i < jetons.length; i++) {
    const m = jetons[i].toLowerCase();
    if (m === "join") {
      lireSource(i + 1);
      continue;
    }
    if (m !== "from") continue;
    // Liste de sources au même niveau de parenthèses, jusqu'à un mot de fin ou la parenthèse qui ferme.
    let j = lireSource(i + 1);
    let p = 0;
    for (; j < jetons.length; j++) {
      const t = jetons[j];
      if (t === "(") p++;
      else if (t === ")") {
        if (p === 0) break;
        p--;
      } else if (p === 0 && t === ",") j = lireSource(j + 1) - 1;
      else if (p === 0 && FIN_SOURCES.test(t)) break;
    }
  }
  return sortie;
}
