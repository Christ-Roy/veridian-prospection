/**
 * VER-130 : une vue de segment tirée d'une phrase (« plombiers de 10 à 49 salariés en Isère joignables par email »).
 *
 * Aucun modèle de langage ici, donc aucun coût d'API pour Veridian : l'IA du client (porte MCP du Hub) reçoit la même
 * proposition par l'outil `vue_depuis_phrase` et la corrige si besoin ; l'écran l'affiche, l'utilisateur la retouche à
 * la main avant ou après l'enregistrement. Chaque condition dit le morceau de phrase qui l'a produite, et les mots que
 * l'interpréteur n'a pas compris sont rendus tels quels : jamais de condition inventée en silence.
 *
 * Deux paquets, comme le flux d'Atlas : `marche` (champs du cube, tout le marché : métier, zone, taille, création) et
 * `cible` (joignabilité et signaux, sur les fiches prospectables), pour créer un marché puis sa cible.
 */
import { codesParLibelle, motsCles, normaliser } from "./activites";
import type { Condition } from "./filtres";
import { NAF_LIBELLES } from "./naf";

export type Compris = { texte: string; libelle: string; condition: Condition; paquet: "marche" | "cible" };
export type Analyse = { compris: Compris[]; metier: string[]; ignores: string[] };

// ── Zones ──

const DEPARTEMENTS: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche",
  "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
  "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse",
  "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
  "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire",
  "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique", "45": "Loiret",
  "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne",
  "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord", "60": "Oise", "61": "Orne",
  "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin",
  "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie", "75": "Paris",
  "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne",
  "83": "Var", "84": "Vaucluse", "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
  "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise", "971": "Guadeloupe",
  "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte",
};

const REGIONS: Record<string, string[]> = {
  "Auvergne-Rhône-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
  "Bourgogne-Franche-Comté": ["21", "25", "39", "58", "70", "71", "89", "90"],
  Bretagne: ["22", "29", "35", "56"],
  "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
  Corse: ["2A", "2B"],
  "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
  "Hauts-de-France": ["02", "59", "60", "62", "80"],
  "Île-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
  Normandie: ["14", "27", "50", "61", "76"],
  "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
  Occitanie: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
  "Pays de la Loire": ["44", "49", "53", "72", "85"],
  "Provence-Alpes-Côte d'Azur": ["04", "05", "06", "13", "83", "84"],
};
const ALIAS_REGIONS: Record<string, string> = { paca: "Provence-Alpes-Côte d'Azur", idf: "Île-de-France", aura: "Auvergne-Rhône-Alpes", "region parisienne": "Île-de-France" };

/** Grandes villes : la zone d'une ville est son département (le cube ne descend pas à la commune). */
const VILLES: Record<string, string> = {
  paris: "75", marseille: "13", lyon: "69", toulouse: "31", nice: "06", nantes: "44", montpellier: "34", strasbourg: "67", bordeaux: "33",
  lille: "59", rennes: "35", reims: "51", toulon: "83", "saint etienne": "42", grenoble: "38", dijon: "21", angers: "49", nimes: "30",
  villeurbanne: "69", "clermont ferrand": "63", "le mans": "72", "aix en provence": "13", brest: "29", tours: "37", amiens: "80", limoges: "87",
  annecy: "74", perpignan: "66", metz: "57", besancon: "25", orleans: "45", rouen: "76", mulhouse: "68", caen: "14", nancy: "54", avignon: "84",
  poitiers: "86", "la rochelle": "17", pau: "64", chambery: "73", valence: "26", bayonne: "64", "le havre": "76", ajaccio: "2A", bastia: "2B",
};

/** Noms de département qui sont aussi des mots courants : il faut « dans le », « en », « du »… devant. */
const AMBIGUS = new Set(["lot", "cher", "manche", "nord", "var", "somme", "landes", "vienne", "indre", "eure", "loire", "orne", "aube", "ain", "marne", "gard", "aude", "tarn", "jura", "oise", "creuse", "vosges", "allier", "meuse", "doubs", "gers", "paris"]);
const DEVANT_ZONE = /(?:^|\s)(?:dans|en|du|le|la|les|l|sur|vers|a|autour|pres|region|departement|dept|cote)\s*$/;

/** « Côte-d'Or » → « cote d or » : la forme cherchée dans la phrase normalisée. */
const cle = (s: string) => normaliser(s).replace(/[^a-z0-9]+/g, " ").trim();

// ── Effectifs (tranches SIRENE) ──

const TRANCHES: [string, number, number][] = [
  ["00", 0, 0], ["01", 1, 2], ["02", 3, 5], ["03", 6, 9], ["11", 10, 19], ["12", 20, 49], ["21", 50, 99], ["22", 100, 199], ["31", 200, 249],
  ["32", 250, 499], ["41", 500, 999], ["42", 1000, 1999], ["51", 2000, 4999], ["52", 5000, 9999], ["53", 10000, Infinity],
];
/** Tranches comprises entre a et b salariés ; à défaut de tranche entière, celles qui chevauchent. */
export function tranchesEntre(a: number, b: number): string[] {
  const dedans = TRANCHES.filter(([, lo, hi]) => lo >= a && hi <= b).map(([c]) => c);
  return dedans.length ? dedans : TRANCHES.filter(([, lo, hi]) => hi >= a && lo <= b).map(([c]) => c);
}
const TAILLES_NOMMEES: [RegExp, string, [number, number]][] = [
  [/\b(?:tpe|micro[ -]?entreprises?|tres petites entreprises?)\b/, "TPE (moins de 10 salariés)", [0, 9]],
  [/\bpme\b/, "PME (10 à 249 salariés)", [10, 249]],
  [/\b(?:eti|entreprises? de taille intermediaire)\b/, "ETI (250 à 4 999 salariés)", [250, 4999]],
  [/\bgrand(?:e|es)? (?:entreprises?|groupes?|comptes?)\b/, "grandes entreprises (5 000 salariés et plus)", [5000, Infinity]],
  [/\bpetites? (?:entreprises?|structures?|boites?|societes?)\b/, "petites entreprises (moins de 50 salariés)", [0, 49]],
];
const SALARIES = "(?:salaries?|employes?|personnes|collaborateurs?|etp|sal)";

// ── Mots sans contenu de métier ──

const VIDES = new Set([
  "je", "j", "on", "nous", "mes", "mon", "ma", "vends", "vend", "vendre", "cherche", "cherchons", "veux", "voudrais", "cible", "cibler", "ciblons", "trouver",
  "prospecter", "prospects", "prospect", "clients", "client", "entreprise", "entreprises", "societe", "societes", "boites", "boite", "structures", "structure",
  "professionnels", "pros", "pro", "france", "francaises", "francais", "toute", "toutes", "tous", "tout", "qui", "que", "dont", "ont", "sont", "avec", "sans",
  "les", "des", "une", "un", "le", "la", "l", "de", "du", "d", "et", "ou", "en", "dans", "sur", "aux", "au", "a", "pour", "par", "leur", "leurs", "ayant",
  "joignables", "joignable", "contactables", "contactable", "plus", "moins", "entre", "region", "departement", "secteur", "zone", "autour", "pres", "type",
  "metier", "metiers", "activite", "activites", "domaine", "ville", "villes", "petites", "petite", "grandes", "grande", "taille", "ans", "an", "depuis",
  "apres", "avant", "creees", "cree", "crees", "creee", "recentes", "recente", "jeunes", "jeune", "nouvelles", "nouvelle", "etablies", "anciennes",
]);

/**
 * Lit la phrase, sans réseau : zone, taille, création, joignabilité, signaux. Ce qui reste (hors mots vides) est le
 * métier, résolu en codes NAF par `proposerVue`. Pure, déterministe, testable.
 */
export function analyserPhrase(phrase: string, aujourdhui = new Date()): Analyse {
  let t = ` ${cle(phrase.slice(0, 300))} `;
  const compris: Compris[] = [];
  const retirer = (m: string) => {
    t = t.replace(m, " ");
  };
  const ajouter = (texte: string, libelle: string, condition: Condition, paquet: Compris["paquet"] = "marche") =>
    compris.push({ texte: texte.trim(), libelle, condition, paquet });

  // Joignabilité et signaux (cible) : avant la zone, « joignables par téléphone » ne doit pas devenir un lieu.
  const contact: [RegExp, string, Condition][] = [
    [/\b(?:(?:avec|ayant|joignables?|contactables?|par)\s+(?:un\s+|une\s+|l\s+)?)?(?:e ?mails?|courriels?|mails?|adresses? e ?mail)\b(?:\s+(?:valides?|verifies?|envoyables?|pro))?/, "email envoyable", { champ: "email_envoyable", op: "est", valeur: true }],
    [/\b(?:(?:avec|ayant|joignables?|contactables?|par)\s+(?:un\s+|le\s+)?)?(?:telephones?|tel|numeros?(?: de telephone)?|appel(?:er)?)\b/, "téléphone utilisable", { champ: "telephone_envoyable", op: "est", valeur: true }],
    [/\bsans (?:site(?: web| internet)?|site)\b/, "sans site web", { champ: "site", op: "renseigne", valeur: false }],
    [/\b(?:avec|ayant|qui ont) (?:un )?(?:site(?: web| internet)?)\b/, "avec un site web", { champ: "site", op: "renseigne", valeur: true }],
    [/\b(?:e ?commerce|boutiques? en ligne|vente en ligne|vendent en ligne|site marchand)\b/, "vente en ligne", { champ: "ecommerce", op: "est", valeur: true }],
    [/\b(?:labellis\w* )?rge\b/, "label RGE", { champ: "rge", op: "est", valeur: true }],
    [/\b(?:certifi\w* )?qualiopi\b/, "certifiées Qualiopi", { champ: "qualiopi", op: "est", valeur: true }],
  ];
  for (const [re, lib, cond] of contact) {
    const m = t.match(re);
    if (m) {
      ajouter(m[0], lib, cond, "cible");
      retirer(m[0]);
    }
  }
  const joignable = t.match(/\b(?:joignables?|contactables?)\b/);
  if (joignable && !compris.some((c) => c.condition.champ === "email_envoyable" || c.condition.champ === "telephone_envoyable")) {
    ajouter(joignable[0], "joignables : email envoyable", { champ: "email_envoyable", op: "est", valeur: true }, "cible");
    retirer(joignable[0]);
  }

  // Taille : bornes chiffrées d'abord, puis les noms (TPE, PME…).
  const tailles: [RegExp, (m: RegExpMatchArray) => [number, number]][] = [
    [new RegExp(`\\b(?:de|entre)\\s+(\\d+)\\s+(?:a|et)\\s+(\\d+)\\s+${SALARIES}\\b`), (m) => [+m[1], +m[2]]],
    [new RegExp(`\\b(?:plus de|au moins|minimum|des|a partir de)\\s+(\\d+)\\s+${SALARIES}\\b`), (m) => [+m[1], Infinity]],
    [new RegExp(`\\b(\\d+)\\s+${SALARIES}\\s+(?:et plus|ou plus|minimum|au moins)\\b`), (m) => [+m[1], Infinity]],
    [new RegExp(`\\b(?:moins de|au plus|maximum|jusqu a)\\s+(\\d+)\\s+${SALARIES}\\b`), (m) => [0, Math.max(0, +m[1] - 1)]],
    [new RegExp(`\\bsans\\s+${SALARIES}\\b|\\b0\\s+${SALARIES}\\b|\\b(?:independants?|auto ?entrepreneurs?|solos?)\\b`), () => [0, 0]],
    [new RegExp(`\\b(\\d+)\\s+${SALARIES}\\b`), (m) => [+m[1], +m[1]]],
  ];
  let taille = false;
  for (const [re, bornes] of tailles) {
    const m = t.match(re);
    if (!m) continue;
    const [a, b] = bornes(m);
    const codes = tranchesEntre(a, b);
    if (codes.length) {
      const lib = b === Infinity ? `${a} salariés et plus` : a === b ? `${a} salarié${a > 1 ? "s" : ""}` : a === 0 ? `moins de ${b + 1} salariés` : `${a} à ${b} salariés`;
      ajouter(m[0], lib, { champ: "effectif", op: "dans", valeur: codes });
      retirer(m[0]);
      taille = true;
      break;
    }
  }
  if (!taille) {
    for (const [re, lib, [a, b]] of TAILLES_NOMMEES) {
      const m = t.match(re);
      if (m) {
        ajouter(m[0], lib, { champ: "effectif", op: "dans", valeur: tranchesEntre(a, b) });
        retirer(m[0]);
        break;
      }
    }
  }

  // Création : « créées depuis 2020 », « de moins de 3 ans », « récentes ».
  const an = aujourdhui.getUTCFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const ilYa = (n: number) => iso(new Date(Date.UTC(an - n, aujourdhui.getUTCMonth(), aujourdhui.getUTCDate())));
  const creation: [RegExp, (m: RegExpMatchArray) => [string, string] | null][] = [
    [/\b(?:creees?|crees?|nees?|fondees?|immatriculees?)?\s*(?:depuis|apres|a partir de|en)\s+((?:19|20)\d{2})\b/, (m) => [`${m[1]}-01-01`, `créées depuis ${m[1]}`]],
    [/\b(?:de|ayant)\s+moins\s+de\s+(\d{1,2})\s+ans?\b/, (m) => [ilYa(+m[1]), `créées il y a moins de ${m[1]} ans`]],
    [/\b(?:jeunes|recentes|nouvelles)\s+(?:entreprises?|societes?|structures?)?|\b(?:recemment\s+)?creees?\s+recemment\b/, () => [ilYa(3), "créées il y a moins de 3 ans"]],
  ];
  for (const [re, f] of creation) {
    const m = t.match(re);
    const r = m && f(m);
    if (m && r) {
      ajouter(m[0], r[1], { champ: "date_creation", op: "apres", valeur: r[0] });
      retirer(m[0]);
      break;
    }
  }
  const anciennes = t.match(/\b(?:de\s+)?plus\s+de\s+(\d{1,2})\s+ans?\b/);
  if (anciennes) {
    ajouter(anciennes[0], `créées il y a plus de ${anciennes[1]} ans`, { champ: "date_creation", op: "avant", valeur: ilYa(+anciennes[1]) });
    retirer(anciennes[0]);
  }

  // Zone : régions, départements par nom, villes, numéros (« dans le 69 », « 38 et 73 »), codes postaux.
  const departements = new Map<string, string>();
  const noter = (code: string, texte: string) => {
    if (!departements.has(code)) departements.set(code, texte.trim());
  };
  const enListe = (formes: Record<string, string[]>) => Object.entries(formes).sort((a, b) => b[0].length - a[0].length);
  const regions: Record<string, string[]> = {};
  for (const [nom, codes] of Object.entries(REGIONS)) regions[cle(nom)] = codes;
  for (const [alias, nom] of Object.entries(ALIAS_REGIONS)) regions[alias] = REGIONS[nom];
  for (const [forme, codes] of enListe(regions)) {
    const m = t.match(new RegExp(`(?:^|\\s)${forme}(?=\\s)`));
    if (m) {
      const nom = Object.entries(REGIONS).find(([, c]) => c === codes)?.[0] ?? forme;
      ajouter(m[0], `région ${nom}`, { champ: "departement", op: "dans", valeur: codes });
      retirer(m[0]);
    }
  }
  const noms: Record<string, string[]> = {};
  for (const [code, nom] of Object.entries(DEPARTEMENTS)) noms[cle(nom)] = [code];
  for (const [forme, [code]] of enListe(noms)) {
    const re = new RegExp(`(?:^|\\s)${forme}(?=\\s)`);
    const m = t.match(re);
    if (!m) continue;
    if (AMBIGUS.has(forme) && !DEVANT_ZONE.test(t.slice(0, m.index! + (m[0].startsWith(" ") ? 1 : 0)))) continue;
    noter(code, m[0]);
    retirer(m[0]);
  }
  const villes: Record<string, string[]> = {};
  for (const [v, code] of Object.entries(VILLES)) villes[v] = [code];
  for (const [forme, [code]] of enListe(villes)) {
    const m = t.match(new RegExp(`(?:^|\\s)${forme}(?=\\s)`));
    if (!m) continue;
    if (forme === "paris" && departements.has("75")) continue;
    noter(code, m[0]);
    retirer(m[0]);
  }
  const numeros = t.match(/\b(?:dans|en|du|le|les|departements?|dept|dep)\s+((?:97[1-6]|2a|2b|\d{2})(?:\s+(?:et|ou)?\s*(?:97[1-6]|2a|2b|\d{2}))*)(?=\s)(?!\s+(?:salaries?|employes?|personnes|ans?|euros?|k|m|%))/);
  if (numeros) {
    for (const n of numeros[1].split(/\s+(?:et|ou)?\s*/)) {
      const code = n.toUpperCase().padStart(2, "0");
      if (DEPARTEMENTS[code]) noter(code, n);
    }
    retirer(numeros[0]);
  }
  const postaux = t.match(/\b\d{5}\b/g) ?? [];
  if (postaux.length) {
    ajouter(postaux.join(", "), `code postal ${postaux.join(", ")}`, { champ: "code_postal", op: "dans", valeur: postaux }, "cible");
    for (const p of postaux) retirer(p);
  }
  if (departements.size) {
    const codes = [...departements.keys()];
    const deja = compris.find((c) => c.condition.champ === "departement");
    if (deja) {
      const union = [...new Set([...(deja.condition.valeur as string[]), ...codes])];
      deja.condition = { ...deja.condition, valeur: union };
      deja.libelle += ` et ${codes.map((c) => DEPARTEMENTS[c]).join(", ")}`;
      deja.texte += `, ${[...departements.values()].join(", ")}`;
    } else {
      ajouter([...departements.values()].join(", "), `${codes.length > 1 ? "départements" : "département"} ${codes.map((c) => `${DEPARTEMENTS[c]} (${c})`).join(", ")}`, { champ: "departement", op: "dans", valeur: codes });
    }
  }

  // Le reste : le métier.
  const restants = t.split(/\s+/).filter(Boolean);
  const metier = restants.filter((m) => m.length >= 3 && !VIDES.has(m) && !/^\d+$/.test(m));
  const ignores = restants.filter((m) => !metier.includes(m) && !VIDES.has(m) && m.length > 1);
  return { compris, metier, ignores };
}

/** Recherche des codes NAF par l'usage réel (noms d'entreprises), fournie par la source ClickHouse. */
export type ChercheActivites = (radicaux: readonly string[], codesLibelle: readonly string[], limite: number) => Promise<{ naf: string; par_nom: number; signaux: readonly string[] }[]>;

export type Proposition = {
  nom_propose: string;
  filtre: { conditions: Condition[] };
  marche: Condition[];
  cible: Condition[];
  compris: { texte: string; libelle: string; paquet: "marche" | "cible" }[];
  non_compris: string[];
};

/**
 * Le métier en codes NAF. L'usage réel d'abord (les codes que portent les entreprises dont le nom contient les mots :
 * ceux qui en font 90 %, 8 au plus, sans la traîne), car le libellé seul trompe : « plombiers » y trouve la
 * métallurgie du plomb (2443Z) quand les plombiers sont en 4322A. Sans source ou sans fiche, les libellés officiels.
 */
export async function codesMetier(mots: string[], chercher?: ChercheActivites): Promise<{ codes: string[]; source: "libelle" | "usage" | null; mots: string[] }> {
  const radicaux = motsCles(mots.join(" "));
  if (!radicaux.length) return { codes: [], source: null, mots: [] };
  const tous = codesParLibelle(radicaux);
  if (chercher) {
    let usage = await chercher(radicaux, tous.slice(0, 12), 20);
    if (!usage.some((c) => c.par_nom > 0) && radicaux.length > 1) usage = await chercher(radicaux.slice(0, 1), codesParLibelle(radicaux.slice(0, 1)).slice(0, 12), 20);
    usage = usage.filter((c) => c.par_nom > 0).sort((a, b) => b.par_nom - a.par_nom);
    const somme = usage.reduce((s, c) => s + c.par_nom, 0);
    const garde: string[] = [];
    let cumul = 0;
    for (const c of usage) {
      if (garde.length >= 8 || (garde.length && cumul >= 0.9 * somme)) break;
      if (c.par_nom < Math.max(3, somme * 0.02)) break;
      garde.push(c.naf);
      cumul += c.par_nom;
    }
    if (garde.length) return { codes: garde, source: "usage", mots: radicaux };
  }
  if (tous.length && tous.length <= 12) return { codes: tous, source: "libelle", mots: radicaux };
  const parMot = [...new Set(radicaux.flatMap((r) => codesParLibelle([r])))];
  return parMot.length && parMot.length <= 12 ? { codes: parMot, source: "libelle", mots: radicaux } : { codes: [], source: null, mots: radicaux };
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** La proposition complète : analyse, métier en NAF, nom proposé. N'écrit rien. */
export async function proposerVue(phrase: string, chercher?: ChercheActivites, aujourdhui = new Date()): Promise<Proposition> {
  const a = analyserPhrase(phrase, aujourdhui);
  const compris = [...a.compris];
  const non_compris = [...a.ignores];
  let titre = "";
  if (a.metier.length) {
    const m = await codesMetier(a.metier, chercher);
    if (m.codes.length) {
      const libelles = m.codes.slice(0, 3).map((c) => `${NAF_LIBELLES[c] ?? c} (${c})`);
      compris.unshift({
        texte: a.metier.join(" "),
        libelle: `métier : ${libelles.join(", ")}${m.codes.length > 3 ? ` et ${m.codes.length - 3} autre${m.codes.length > 4 ? "s" : ""}` : ""}${m.source === "usage" ? ", d'après le nom des entreprises" : ""}`,
        condition: { champ: "naf", op: "dans", valeur: m.codes },
        paquet: "marche",
      });
      const originaux = phrase.split(/[^\p{L}\p{N}'-]+/u).filter((w) => a.metier.includes(cle(w)));
      titre = majuscule(originaux.join(" ") || a.metier.join(" "));
    } else {
      non_compris.unshift(...a.metier);
    }
  }
  const zone = compris.find((c) => c.condition.champ === "departement");
  const nomZone = zone ? (zone.libelle.startsWith("région ") ? zone.libelle.slice(7) : (zone.condition.valeur as string[]).map((c) => DEPARTEMENTS[c]).join(", ")) : "";
  const nom_propose = [titre, nomZone].filter(Boolean).join(" · ").slice(0, 120) || majuscule(phrase.trim().slice(0, 60));
  const marche = compris.filter((c) => c.paquet === "marche").map((c) => c.condition);
  const cible = compris.filter((c) => c.paquet === "cible").map((c) => c.condition);
  return {
    nom_propose,
    filtre: { conditions: [...marche, ...cible] },
    marche,
    cible,
    compris: compris.map(({ texte, libelle, paquet }) => ({ texte, libelle, paquet })),
    non_compris: [...new Set(non_compris)],
  };
}
