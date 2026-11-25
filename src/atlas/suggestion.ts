/**
 * Règles de priorité proposées d'après les clients importés (VISION-ATLAS R1) : ce qui est plus fréquent chez les clients que dans le
 * segment. Aucune boîte noire : chaque règle porte ses deux pourcentages, l'utilisateur ou son IA décide.
 */
import type { Condition, Filtre } from "./filtres";
import { CHAMP } from "./champs";
import { libelleValeur } from "./libelles";
import * as seg from "./segments";
import { sourceMarche } from "./source";

export const CLIENTS_MIN = 10;
const LISTES = ["taille", "effectif", "forme_juridique", "secteur", "niveau_web", "type_logiciel", "signal_12_mois", "departement"];
const DRAPEAUX: Condition[] = [
  { champ: "site", op: "renseigne", valeur: true },
  { champ: "ecommerce", op: "est", valeur: true },
  { champ: "rge", op: "est", valeur: true },
  { champ: "qualiopi", op: "est", valeur: true },
];
export type RegleProposee = { condition: Condition; libelle: string; points: number; part_clients_pct: number; part_segment_pct: number; clients: number };

/** Écart jugé réel : assez de clients, nettement plus fréquent, et pas un hasard d'échantillon (2 écarts types). */
export function juger(nc: number, clients: number, nt: number, total: number): { points: number; z: number; pc: number; pt: number } | null {
  if (!clients || !total || nc < Math.max(3, clients * 0.05)) return null;
  const pc = nc / clients, pt = nt / total;
  if (pt <= 0 || pt >= 1) return null;
  const lift = pc / pt, z = (pc - pt) / Math.sqrt((pt * (1 - pt)) / clients);
  if (lift < 1.3 || pc - pt < 0.05 || z < 2) return null;
  return { points: Math.min(30, Math.max(3, Math.round(Math.log2(lift) * 10))), z, pc, pt };
}

export async function proposerPriorite(tenantId: string, segmentId: string) {
  const s = await seg.lireSegment(tenantId, segmentId);
  const effectif = await seg.filtreEffectif(tenantId, segmentId);
  // Les clients servent d'exemple : un segment « hors clients » se compare sans cette condition.
  const base: Filtre = { ...effectif, conditions: effectif.conditions.filter((c) => c.champ !== "client") };
  const avec = (...c: Condition[]): Filtre => ({ ...base, conditions: [...base.conditions, ...c] });
  const CLIENT: Condition = { champ: "client", op: "est", valeur: true };
  const src = sourceMarche();
  const [total, clients] = await Promise.all([src.compter(base), src.compter(avec(CLIENT))]);
  if (clients < CLIENTS_MIN)
    return { segment: s.nom, clients, total, regles: [] as RegleProposee[], message: `Il faut au moins ${CLIENTS_MIN} clients contactables dans ce segment pour proposer des règles (il y en a ${clients}). Importez vos clients, ou essayez sur un segment plus large.` };
  const deja = new Set(base.conditions.map((c) => c.champ));
  const trouvees: (RegleProposee & { z: number })[] = [];
  const poser = (condition: Condition, libelle: string, nc: number, nt: number) => {
    const j = juger(nc, clients, nt, total);
    if (j) trouvees.push({ condition, libelle, points: j.points, part_clients_pct: Math.round(j.pc * 1000) / 10, part_segment_pct: Math.round(j.pt * 1000) / 10, clients: nc, z: j.z });
  };
  for (const champ of LISTES.filter((c) => !deja.has(c))) {
    const [a, b] = await Promise.all([src.repartition(avec(CLIENT), champ, 200), src.repartition(base, champ, 200)]);
    const tous = new Map(b.map((x) => [x.cle, x.nombre]));
    for (const x of a) poser({ champ, op: "dans", valeur: [x.cle] }, `${CHAMP.get(champ)!.libelle} : ${libelleValeur(champ, x.cle)}`, x.nombre, tous.get(x.cle) ?? 0);
  }
  for (const c of DRAPEAUX.filter((d) => !deja.has(d.champ))) {
    const [nc, nt] = await Promise.all([src.compter(avec(CLIENT, c)), src.compter(avec(c))]);
    poser(c, c.op === "renseigne" ? "A un site web" : CHAMP.get(c.champ)!.libelle, nc, nt);
  }
  const regles = trouvees.sort((x, y) => y.z - x.z).slice(0, 8).map(({ z: _z, ...r }) => r);
  return {
    segment: s.nom,
    clients,
    total,
    regles,
    ...(regles.length ? { lecture: "Plus fréquent chez vos clients que dans le segment : à relire, puis definir_scoring. Une corrélation, pas une cause." } : { message: "Vos clients ressemblent au reste du segment : aucun critère ne s'en détache nettement." }),
  };
}
