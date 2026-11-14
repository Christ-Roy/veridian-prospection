/**
 * Base maître d'ODH (`odh.company_master_current`, livrée le 14/11) : une ligne par SIREN, les 30 M
 * d'entreprises, sans aucun contact brut (seulement des drapeaux). C'est la base qui « parle de tout »
 * (Robert, 14/11) : on y liste et compte le marché entier ; les coordonnées restent dans la vue prospectable.
 *
 * Un filtre Atlas s'y traduit champ par champ ; ce qui n'existe pas dans la base maître (score, web, signaux…)
 * est rendu dans `ignorees`, jamais ignoré en silence. Le nom se cherche par les index de jetons d'ODH
 * (name_terms = mots entiers, name_prefixes = radicaux de 4 à 6 lettres) : pas d'expression régulière.
 * Limites du compte : 15 M lignes lues et 10 s ; un comptage sans filtre passe par le cube.
 */
import { formesFamille, motsCles } from "./activites";
import { FiltreInvalide, FiltreSchema, type Condition, type SqlParam } from "./filtres";

export const TABLE_MAITRE = "odh.company_master_current";

/** Champs Atlas → colonne de la base maître. */
const LISTES: Record<string, string> = {
  naf: "naf_code",
  departement: "department",
  forme_juridique: "legal_form",
  effectif: "tranche_effectif",
  code_postal: "postal_code",
};
const DRAPEAUX: Record<string, string> = {
  email: "has_email",
  telephone: "has_phone",
  site: "has_site",
  email_envoyable: "email_envoyable",
  telephone_envoyable: "telephone_envoyable",
};

/** Colonnes rendues par une liste : identité, lieu, drapeaux. Ids alignés sur le catalogue quand il y a un équivalent. */
export const COLONNES_MAITRE: Record<string, string> = {
  siren: "siren",
  nom: "legal_name",
  enseigne: "trade_name",
  commune: "city",
  departement: "department",
  naf: "naf_code",
  forme: "forme_type",
  effectif: "tranche_effectif",
  date_creation: "creation_date",
  a_email: "has_email",
  a_telephone: "has_phone",
  a_site: "has_site",
  prospectable: "prospectable",
};

/**
 * Un radical de nom se cherche par les MOTS ENTIERS de sa famille dans name_terms (chasse, chasseur,
 * chasseurs…) : name_prefixes attraperait tout mot qui commence pareil (« Chasseneuil »).
 */
export function conditionNom(radical: string, nom: string, params: Record<string, SqlParam>): string {
  params[nom] = { type: "Array(String)", valeur: formesFamille(radical) };
  return `hasAnyTokens(name_terms, {${nom}:Array(String)})`;
}

export type CompileMaitre = { where: string; params: Record<string, SqlParam>; ignorees: Condition[]; filtre: boolean };

export function compilerMaitre(brut: unknown, actives = true): CompileMaitre {
  const f = FiltreSchema.parse(brut ?? {});
  const params: Record<string, SqlParam> = {};
  const where: string[] = [];
  const ignorees: Condition[] = [];
  let n = 0;
  const p = (type: string, valeur: unknown) => {
    const k = `q${n++}`;
    params[k] = { type, valeur };
    return `{${k}:${type}}`;
  };
  for (const c of f.conditions) {
    const v = c.valeur;
    if (LISTES[c.champ] && (c.op === "dans" || c.op === "hors")) {
      const l = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : [];
      if (!l.length) throw new FiltreInvalide(`${c.champ} : une ou plusieurs valeurs`);
      const valeurs = c.champ === "naf" ? l.map((x) => x.replace(".", "").toUpperCase()) : l;
      where.push(`${LISTES[c.champ]} ${c.op === "hors" ? "NOT IN" : "IN"} ${p("Array(String)", valeurs)}`);
      continue;
    }
    if (c.champ === "naf_division" && c.op === "dans" && Array.isArray(v) && v.length) {
      where.push(`substring(naf_code, 1, 2) IN ${p("Array(String)", v.map(String))}`);
      continue;
    }
    if (c.champ === "commune" && c.op === "egal" && typeof v === "string" && v.trim()) {
      where.push(`city = ${p("String", v.trim().toUpperCase())}`);
      continue;
    }
    if (c.champ === "date_creation" && (c.op === "apres" || c.op === "avant") && typeof v === "string") {
      where.push(`creation_date ${c.op === "apres" ? ">=" : "<"} ${p("Date", v)}`);
      continue;
    }
    if (DRAPEAUX[c.champ] && ((c.op === "renseigne" && typeof v === "boolean") || (c.op === "est" && typeof v === "boolean"))) {
      where.push(`${DRAPEAUX[c.champ]} = ${v ? 1 : 0}`);
      continue;
    }
    if (c.champ === "nom" && c.op === "contient" && typeof v === "string") {
      const r = motsCles(v);
      if (!r.length) throw new FiltreInvalide("nom : au moins un mot de 3 lettres");
      for (const m of r) where.push(conditionNom(m, `q${n++}`, params));
      continue;
    }
    ignorees.push(c);
  }
  const filtre = where.length > 0;
  if (actives) where.unshift("administrative_status = 'A'");
  return { where: where.join(" AND ") || "1", params, ignorees, filtre };
}
