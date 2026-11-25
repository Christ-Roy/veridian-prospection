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
  const c = brut.replace(/[\s.  -]/g, "").replace(/^FR\d{2}(?=\d{9}$)/i, "");
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

export function lireFichierClients(texte: string): { numeros: string[]; colonne: string | null; ecartes: number } {
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lignes.length) return { numeros: [], colonne: null, ecartes: 0 };
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
  return bilan((titre ? table.slice(1) : table).map((l) => l[k] ?? ""), largeur > 1 ? titre : null);
}
function bilan(valeurs: string[], colonne: string | null) {
  const lus = valeurs.filter((v) => v.trim()).map(lireNumero);
  return { numeros: [...new Set(lus.filter((x): x is string => !!x))], colonne, ecartes: lus.filter((x) => !x).length };
}

/** « 0,042 % » : un taux de pénétration est souvent petit, l'arrondir à 0 le ferait disparaître. */
export function pourcent(p: number | null): string {
  if (p === null) return "–";
  if (p === 0) return "0 %";
  return `${p.toLocaleString("fr-FR", { maximumSignificantDigits: p < 10 ? 2 : 3 })} %`;
}
