/** Lecture d'un fichier de clients (CSV, texte, collage) : on trouve la bonne colonne tout seul. Pur, éprouvé. */

/** Même règle que le serveur (src/atlas/clients.ts), qui revérifie tout. */
export function sirenValide(s: string): boolean {
  if (!/^\d{9}$/.test(s) || /^0+$/.test(s)) return false;
  let t = 0;
  for (let i = 0; i < 9; i++) {
    const d = Number(s[8 - i]) * (i % 2 ? 2 : 1);
    t += d > 9 ? d - 9 : d;
  }
  return t % 10 === 0;
}
export function lireNumero(brut: string): string | null {
  const c = brut.replace(/[\s.\u00a0\u202f-]/g, "").replace(/^FR\d{2}(?=\d{9}$)/i, "");
  if (!/^\d{7,14}$/.test(c)) return null;
  const s = c.length <= 9 ? c.padStart(9, "0") : c.length >= 13 ? c.padStart(14, "0").slice(0, 9) : "";
  return sirenValide(s) ? s : null;
}

/** Cellules d'une ligne, guillemets compris. */
export function cellules(ligne: string, sep: string): string[] {
  const r: string[] = [];
  let c = "", dedans = false;
  for (let i = 0; i < ligne.length; i++) {
    const x = ligne[i];
    if (x === '"') {
      if (dedans && ligne[i + 1] === '"') { c += `"`; i++; }
      else dedans = !dedans;
    } else if (x === sep && !dedans) { r.push(c.trim()); c = ""; }
    else c += x;
  }
  r.push(c.trim());
  return r;
}

export type VenteLue = { numero: string; montant: number; date: string | null; reference: string | null };
export type FichierLu = { numeros: string[]; colonne: string | null; ecartes: number; /** Ventes, si une colonne de montant est reconnue. */ ventes: VenteLue[] | null; colonneMontant: string | null; ventesEcartees: number };

/** « 1 234,56 € », « 1,234.56 », « (120,00) », « -12 » ; null si ce n'est pas un montant. */
export function lireMontant(brut: string): number | null {
  let s = brut.replace(/[\s\u00a0\u202f€]|EUR/gi, "");
  if (!s) return null;
  const negatif = /^\(.*\)$/.test(s) || s.startsWith("-") || s.endsWith("-");
  s = s.replace(/[()\-+]/g, "");
  if (!/^\d[\d.,']*$/.test(s)) return null;
  const dernier = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  // Le dernier séparateur est décimal s'il laisse un ou deux chiffres ; sinon ce sont des milliers.
  const decimal = dernier >= 0 && s.length - dernier - 1 <= 2;
  const n = Number(decimal ? `${s.slice(0, dernier).replace(/[.,']/g, "")}.${s.slice(dernier + 1)}` : s.replace(/[.,']/g, ""));
  return Number.isFinite(n) ? (negatif ? -n : n) : null;
}
/** JJ/MM/AAAA, AAAA-MM-JJ (heure ignorée) → AAAA-MM-JJ ; null sinon. */
export function lireDate(brut: string): string | null {
  const s = brut.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s), fr = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/.exec(s);
  const [a, m, j] = iso ? [iso[1], iso[2], iso[3]] : fr ? [fr[3], fr[2].padStart(2, "0"), fr[1].padStart(2, "0")] : [];
  if (!a) return null;
  const d = `${a}-${m}-${j}`;
  return !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d) ? d : null;
}

export function lireFichierClients(texte: string): FichierLu {
  const lignes = texte.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lignes.length) return { numeros: [], colonne: null, ecartes: 0, ventes: null, colonneMontant: null, ventesEcartees: 0 };
  const sep = [";", "\t", ",", "|"].map((s) => [s, lignes.slice(0, 20).reduce((n, l) => n + l.split(s).length - 1, 0)] as const).sort((a, b) => b[1] - a[1])[0];
  const table = sep[1] ? lignes.map((l) => cellules(l, sep[0])) : lignes.map((l) => [l.trim()]);
  const largeur = Math.max(...table.map((l) => l.length));
  // Une seule ligne de numéros séparés : une liste, pas un tableau.
  if (table.length === 1 && largeur > 1 && table[0].every((c) => !c || lireNumero(c))) return bilan(table[0], null);
  const entete = table[0].map((c) => c.toLowerCase());
  const nommee = (motif: RegExp) => entete.findIndex((c) => motif.test(c) && !lireNumero(c));
  let k = nommee(/\bsiret\b/);
  if (k < 0) k = nommee(/\bsiren\b/);
  // Sans titre reconnu, la colonne qui contient le plus de numéros valides.
  if (k < 0) k = Array.from({ length: largeur }, (_, i) => table.reduce((n, l) => n + (lireNumero(l[i] ?? "") ? 1 : 0), 0)).reduce((m, n, i, t) => (n > t[m] ? i : m), 0);
  const titre = !lireNumero(table[0][k] ?? "") && /[a-z]/i.test(table[0][k] ?? "") ? table[0][k] : null;
  const corps = titre ? table.slice(1) : table;
  const b = bilan(corps.map((l) => l[k] ?? ""), largeur > 1 ? titre : null);
  // Un montant ne se devine jamais : il faut un titre qui le dise. « CA » n'en est pas un : c'est souvent celui du client, pas nos ventes.
  const km = titre ? entete.findIndex((c, i) => i !== k && /(montant|total|vente|\bht\b|\bttc\b|amount)/.test(c) && corps.some((l) => lireMontant(l[i] ?? "") !== null)) : -1;
  if (km < 0) return b;
  const kd = entete.findIndex((c, i) => i !== k && i !== km && /date/.test(c));
  const kr = entete.findIndex((c, i) => i !== k && i !== km && i !== kd && /(facture|r[ée]f[ée]rence|\br[ée]f\b|pi[èe]ce|invoice|n° ?de vente)/.test(c));
  const ventes: VenteLue[] = [];
  let ventesEcartees = 0;
  for (const l of corps) {
    const numero = lireNumero(l[k] ?? ""), montant = lireMontant(l[km] ?? "");
    if (numero && montant !== null) ventes.push({ numero, montant, date: kd >= 0 ? lireDate(l[kd] ?? "") : null, reference: (kr >= 0 && l[kr]?.trim()) || null });
    else ventesEcartees++;
  }
  return { ...b, ventes: ventes.length ? ventes : null, colonneMontant: table[0][km], ventesEcartees };
}
function bilan(valeurs: string[], colonne: string | null): FichierLu {
  const lus = valeurs.filter((v) => v.trim()).map(lireNumero);
  return { numeros: [...new Set(lus.filter((x): x is string => !!x))], colonne, ecartes: lus.filter((x) => !x).length, ventes: null, colonneMontant: null, ventesEcartees: 0 };
}

/** « 0,042 % » : un taux de pénétration est souvent petit, l'arrondir à 0 le ferait disparaître. */
export function pourcent(p: number | null): string {
  if (p === null) return "–";
  if (p === 0) return "0 %";
  return `${p.toLocaleString("fr-FR", { maximumSignificantDigits: p < 10 ? 2 : 3 })} %`;
}
