/**
 * Règles de priorité proposées d'après les clients importés (VISION-ATLAS R1) : ce qui est plus fréquent chez les clients que dans le
 * segment. Aucune boîte noire : chaque règle porte ses deux pourcentages, l'utilisateur ou son IA décide.
 */
import { CLIENTS_MAX } from "./clients";
import type { Condition, Filtre } from "./filtres";
import { CHAMP } from "./champs";
import { libelleValeur } from "./libelles";
import * as seg from "./segments";
import { sourceMarche } from "./source";
import { montantsParClient } from "./ventes";

export const CLIENTS_MIN = 10;
const LISTES = ["taille", "effectif", "forme_juridique", "secteur", "niveau_web", "type_logiciel", "signal_12_mois", "departement"];
const DRAPEAUX: Condition[] = [
  { champ: "site", op: "renseigne", valeur: true },
  { champ: "ecommerce", op: "est", valeur: true },
  { champ: "rge", op: "est", valeur: true },
  { champ: "qualiopi", op: "est", valeur: true },
];
export type RegleProposee = {
  condition: Condition; libelle: string; points: number; part_clients_pct: number; part_segment_pct: number; clients: number;
  /** D'après les ventes : part du montant, et montant moyen par client de ce groupe et des autres. */
  part_montant_pct?: number; moyenne?: number; moyenne_autres?: number;
};

/** Écart jugé réel : assez de clients, nettement plus fréquent, et pas un hasard d'échantillon (2 écarts types). */
export function juger(nc: number, clients: number, nt: number, total: number, reels = nc): { points: number; z: number; pc: number; pt: number } | null {
  if (!clients || !total || reels < 3 || nc < clients * 0.05) return null;
  const pc = nc / clients, pt = nt / total;
  if (pt <= 0 || pt >= 1) return null;
  const lift = pc / pt, z = (pc - pt) / Math.sqrt((pt * (1 - pt)) / clients);
  if (lift < 1.3 || pc - pt < 0.05 || z < 2) return null;
  return { points: Math.min(30, Math.max(3, Math.round(Math.log2(lift) * 10))), z, pc, pt };
}

/** Plafonne les très gros montants (95e centile) : un seul client ne doit pas écrire la règle. */
export function plafonner(m: readonly number[]): number[] {
  const t = m.filter((x) => x > 0).sort((a, b) => a - b);
  if (t.length < 20) return m.map((x) => Math.max(0, x));
  const haut = t[Math.ceil(t.length * 0.95) - 1];
  return m.map((x) => Math.min(Math.max(0, x), haut));
}
/** Taille d'échantillon réelle de poids inégaux (Kish) : dix clients dont un fait tout le chiffre en valent un. */
export const taillePonderee = (w: readonly number[]): number => {
  const s = w.reduce((a, b) => a + b, 0), q = w.reduce((a, b) => a + b * b, 0);
  return q > 0 ? (s * s) / q : 0;
};

type Groupe = { condition: Condition; libelle: string; dedans: (l: Record<string, unknown>) => boolean; tous: number };

export async function proposerPriorite(tenantId: string, segmentId: string, selon?: "clients" | "montant") {
  const s = await seg.lireSegment(tenantId, segmentId);
  const effectif = await seg.filtreEffectif(tenantId, segmentId);
  // Les clients servent d'exemple : un segment « hors clients » se compare sans cette condition.
  const base: Filtre = { ...effectif, conditions: effectif.conditions.filter((c) => c.champ !== "client") };
  const avec = (...c: Condition[]): Filtre => ({ ...base, conditions: [...base.conditions, ...c] });
  const CLIENT: Condition = { champ: "client", op: "est", valeur: true };
  const src = sourceMarche();
  const deja = new Set(base.conditions.map((c) => c.champ));
  const listes = LISTES.filter((c) => !deja.has(c)), drapeaux = DRAPEAUX.filter((d) => !deja.has(d.champ));
  const colonnes = [...new Set([...listes, ...drapeaux.map((d) => d.champ)])];
  const [total, apercu, montants] = await Promise.all([
    src.compter(base),
    src.apercu(avec(CLIENT), { colonnes: ["nom", ...colonnes], page: 1, parPage: CLIENTS_MAX, plafond: CLIENTS_MAX }),
    montantsParClient(tenantId),
  ]);
  const lignes = apercu.lignes as Record<string, unknown>[];
  const clients = lignes.length;
  const bruts = lignes.map((l) => montants.get(String(l.siren)) ?? 0);
  const payeurs = bruts.filter((x) => x > 0).length;
  const mode = selon ?? (payeurs >= CLIENTS_MIN ? "montant" : "clients");
  const entete = { segment: s.nom, clients, total, selon: mode, clients_avec_vente: payeurs, montant_total: Math.round(bruts.reduce((a, b) => a + b, 0) * 100) / 100 };
  const manque = mode === "montant" ? payeurs : clients;
  if (manque < CLIENTS_MIN)
    return { ...entete, regles: [] as RegleProposee[], message: `Il faut au moins ${CLIENTS_MIN} clients contactables${mode === "montant" ? " avec une vente" : ""} dans ce segment pour proposer des règles (il y en a ${manque}). Importez vos ${mode === "montant" ? "ventes" : "clients"}, ou essayez sur un segment plus large.` };

  const poids = mode === "montant" ? plafonner(bruts) : lignes.map(() => 1);
  const somme = poids.reduce((a, b) => a + b, 0), n = taillePonderee(poids);
  const valeurs = (l: Record<string, unknown>, champ: string) => String(l[champ] ?? "").split(CHAMP.get(champ)?.ensemble || CHAMP.get(champ)?.tableau ? ", " : "\u0000").filter(Boolean);
  const groupes: Groupe[] = [];
  for (const champ of listes) {
    const tous = new Map((await src.repartition(base, champ, 200)).map((x) => [x.cle, x.nombre]));
    for (const cle of new Set(lignes.flatMap((l) => valeurs(l, champ)))) groupes.push({ condition: { champ, op: "dans", valeur: [cle] }, libelle: `${CHAMP.get(champ)!.libelle} : ${libelleValeur(champ, cle)}`, dedans: (l) => valeurs(l, champ).includes(cle), tous: tous.get(cle) ?? 0 });
  }
  for (const c of drapeaux) {
    groupes.push({ condition: c, libelle: c.op === "renseigne" ? "A un site web" : CHAMP.get(c.champ)!.libelle, dedans: (l) => (c.op === "renseigne" ? !!l[c.champ] : l[c.champ] === true || l[c.champ] === 1), tous: await src.compter(avec(c)) });
  }
  const pct = (x: number) => Math.round(x * 1000) / 10;
  const trouvees: (RegleProposee & { z: number })[] = [];
  for (const g of groupes) {
    const dedans = lignes.map(g.dedans);
    const nc = dedans.filter(Boolean).length;
    if (nc < Math.max(3, clients * 0.05)) continue;
    const part = poids.reduce((a, w, i) => a + (dedans[i] ? w : 0), 0) / somme;
    const j = juger(part * n, n, g.tous, total, nc);
    if (!j) continue;
    const moy = (v: boolean) => { const x = bruts.filter((_, i) => dedans[i] === v); return x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length) : 0; };
    trouvees.push({ condition: g.condition, libelle: g.libelle, points: j.points, part_clients_pct: pct(nc / clients), part_segment_pct: pct(j.pt), clients: nc, z: j.z, ...(mode === "montant" ? { part_montant_pct: pct(part), moyenne: moy(true), moyenne_autres: moy(false) } : {}) });
  }
  const regles = trouvees.sort((x, y) => y.z - x.z).slice(0, 8).map(({ z: _z, ...r }) => r);
  const quoi = mode === "montant" ? "pèse plus dans vos ventes" : "est plus fréquent chez vos clients";
  return {
    ...entete,
    regles,
    ...(regles.length ? { lecture: `Ce qui ${quoi} que dans le segment : à relire, puis definir_scoring. Une corrélation, pas une cause.${mode === "montant" ? " Les très gros montants sont plafonnés : un seul client n'écrit pas une règle." : ""}` } : { message: `Rien ne ${mode === "montant" ? "pèse nettement plus dans vos ventes" : "distingue nettement vos clients"} que dans le reste du segment.` }),
  };
}
