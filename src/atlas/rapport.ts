/**
 * Rapport PDF d'un marché : chiffres relus au moment de l'ouverture, texte écrit par une IA ou un humain. Que des comptes, aucune
 * coordonnée ni nom d'entreprise : ouvert à tous les plans.
 */
import { CHAMP } from "./champs";
import { penetration } from "./clients";
import { entreeDepuisFiltre, TRANCHES } from "./cube";
import type { Condition } from "./filtres";
import { libelleValeur } from "./libelles";
import { BLEU, couper, FOND, GRIS, MARGE, Pdf } from "./pdf";
import * as seg from "./segments";
import { sourceMarche } from "./source";

const n = (x: number) => Math.round(x).toLocaleString("fr-FR");
const pc = (a: number, b: number) => (b ? `${((a * 100) / b).toLocaleString("fr-FR", { maximumSignificantDigits: 2 })} %` : "–");
const OPS: Record<string, string> = { dans: "", hors: "hors ", egal: "", contient: "contient ", min: "au moins ", max: "au plus ", entre: "entre ", apres: "depuis ", avant: "avant ", est: "", renseigne: "" };

/** « Département : Rhône, Isère » ; une longue liste se résume. */
export function phrase(c: Condition): string {
  const champ = CHAMP.get(c.champ);
  const un = (v: unknown) => (typeof v === "boolean" ? (v ? "oui" : "non") : libelleValeur(c.champ, String(v)));
  const l = Array.isArray(c.valeur) ? c.valeur.map(un) : c.valeur === undefined ? [] : [un(c.valeur)];
  return `${champ?.libelle ?? c.champ} : ${OPS[c.op] ?? ""}${l.slice(0, 6).join(", ")}${l.length > 6 ? ` et ${l.length - 6} autres` : ""}`;
}

type Barre = { libelle: string; valeur: number; texte?: string };
function barres(p: Pdf, titre: string, l: Barre[]) {
  const utiles = l.filter((b) => b.valeur > 0);
  if (!utiles.length) return;
  p.place(40 + Math.min(utiles.length, 4) * 17);
  p.espace(18);
  p.titre(titre, 12);
  p.espace(4);
  const max = Math.max(...utiles.map((b) => b.valeur));
  const x = MARGE + 170, large = p.large - 170 - 110;
  for (const b of utiles) {
    p.place(17);
    p.texteEn(MARGE, p.y + 10, couper(b.libelle, 9, 162), 9);
    p.rect(x, p.y + 2, large, 10, FOND);
    p.rect(x, p.y + 2, Math.max(1, (large * b.valeur) / max), 10, BLEU);
    p.texteEn(MARGE + p.large, p.y + 10, b.texte ?? n(b.valeur), 9, { couleur: GRIS, droite: true });
    p.y += 17;
  }
}

export async function rapportPdf(tenantId: string, segmentId: string, r: { titre: string; texte: string; auteur: string | null; date: Date }): Promise<{ octets: Buffer; nom: string }> {
  const s = await seg.lireSegment(tenantId, segmentId);
  const filtre = await seg.filtreEffectif(tenantId, segmentId);
  const { entree, ignorees } = entreeDepuisFiltre(filtre);
  const src = sourceMarche();
  const axe = (a: "departement" | "effectif" | "annee_creation" | "naf", limite: number) => src.marche({ ...entree, axe: a, limite });
  const [dep, eff, an, naf, cible, pen] = await Promise.all([
    axe("departement", 120), axe("effectif", 30), axe("annee_creation", 200), axe("naf", 12),
    ignorees.length ? src.compter(filtre) : Promise.resolve(null),
    penetration(tenantId, filtre, "departement"),
  ]);
  const t = dep.total;
  const p = new Pdf();
  p.titre(r.titre, 20);
  p.paragraphe(`${s.nom} · ${r.date.toLocaleDateString("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" })}${r.auteur ? ` · ${r.auteur}` : ""}`, 9.5, GRIS);
  p.espace(10);
  const kpis: [string, string][] = [
    [n(t.entreprises), "entreprises actives"],
    [n(t.prospectables), `contactables (${pc(t.prospectables, t.entreprises)})`],
    [n(t.email_envoyable), "email envoyable"],
    [n(t.telephone_envoyable), "téléphone utilisable"],
    ...(cible !== null ? ([[n(cible), "dans la cible, filtres compris"]] as [string, string][]) : []),
    ...(pen.clients_importes ? ([[`${pen.taux_pct === null ? "–" : pen.taux_pct.toLocaleString("fr-FR", { maximumSignificantDigits: 2 })} %`, `de pénétration (${n(pen.clients_dans_le_marche)} clients)`]] as [string, string][]) : []),
  ];
  const l = (p.large - 16) / 3;
  kpis.forEach(([v, lib], i) => {
    const x = MARGE + (i % 3) * (l + 8), y = p.y + Math.floor(i / 3) * 54;
    p.rect(x, y, l, 46, FOND);
    p.texteEn(x + 10, y + 21, v, 16, { gras: true });
    p.texteEn(x + 10, y + 36, couper(lib, 8.5, l - 20), 8.5, { couleur: GRIS });
  });
  p.y += Math.ceil(kpis.length / 3) * 54;
  if (r.texte.trim()) {
    p.espace(14);
    p.titre("Analyse", 12);
    p.espace(2);
    p.paragraphe(r.texte.trim());
  }
  barres(p, "Départements en tête", dep.lignes.filter((x) => x.cle && x.cle !== "99").slice(0, 12).map((x) => ({ libelle: x.libelle, valeur: x.entreprises, texte: `${n(x.entreprises)} (${pc(x.entreprises, t.entreprises)})` })));
  if (naf.lignes.length > 1) barres(p, "Activités", naf.lignes.map((x) => ({ libelle: x.libelle, valeur: x.entreprises })));
  barres(p, "Taille (salariés)", Object.keys(TRANCHES).map((k) => ({ libelle: TRANCHES[k], valeur: eff.lignes.find((x) => x.cle === k)?.entreprises ?? 0 })));
  const annee = r.date.getFullYear();
  barres(p, "Créations par année", Array.from({ length: 12 }, (_, i) => annee - 11 + i).map((a) => ({ libelle: String(a), valeur: an.lignes.find((x) => Number(x.cle) === a)?.entreprises ?? 0 })));
  if (pen.clients_dans_le_marche) barres(p, "Vos clients par département", (pen.lignes ?? []).slice(0, 10).map((x) => ({ libelle: x.libelle || "Inconnu", valeur: x.clients, texte: `${n(x.clients)}${x.entreprises ? ` sur ${n(x.entreprises)}` : ""}` })));
  p.espace(16);
  p.titre("Définition", 12);
  p.espace(2);
  p.paragraphe(filtre.conditions.length ? filtre.conditions.map(phrase).join("\n") : "Toutes les entreprises de France.", 9);
  if (ignorees.length) p.paragraphe(`Les chiffres du marché ne tiennent pas compte de : ${ignorees.map((c) => CHAMP.get(c.champ)?.libelle ?? c.champ).join(", ")}. La cible, si.`, 9, GRIS);
  p.paragraphe("Entreprises actives, d'après la base Sirene et les sources publiques réunies par Veridian ODH. « Envoyable » et « utilisable » : ce qu'on peut promettre.", 8.5, GRIS);
  return { octets: p.octets(r.titre, `Veridian Atlas · ${s.nom}`.slice(0, 90)), nom: s.nom };
}
