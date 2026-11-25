/**
 * Ventes de l'espace (CSV, ou un ERP par clé `atl_`) : un montant, une date, un SIREN, une référence. La référence rend tout rejouable : la
 * même facture renvoyée remplace, jamais ne double. Vendre à une entreprise en fait un client.
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

import { CLIENTS_MAX, lireNumero, oublierClients } from "./clients";
import { FiltreInvalide } from "./filtres";

export const VENTES_MAX = 200_000;
export const VENTES_PAR_APPEL = 5_000;
export type VenteEntree = { numero: string; montant: number; date?: string | null; reference?: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateValide = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d);

/** Sans référence, une vente se reconnaît à son contenu et à son rang parmi les identiques du même envoi. */
export function reference(v: { siren: string; montant: number; date: string | null }, rang: number): string {
  return `auto:${createHash("sha256").update(`${v.siren}|${v.montant.toFixed(2)}|${v.date ?? ""}|${rang}`).digest("hex").slice(0, 32)}`;
}

export async function importerVentes(tenantId: string, auteur: string, entrees: readonly VenteEntree[]) {
  if (entrees.length > VENTES_PAR_APPEL) throw new FiltreInvalide(`${VENTES_PAR_APPEL} ventes au plus par appel.`);
  const refusees: { ligne: number; raison: string }[] = [];
  const lues = new Map<string, { siren: string; montant: number; date: string | null }>();
  const rangs = new Map<string, number>();
  entrees.forEach((e, i) => {
    const siren = lireNumero(e.numero);
    const raison = !siren ? "numéro" : !Number.isFinite(e.montant) || Math.abs(e.montant) >= 1e10 ? "montant" : e.date && !dateValide(e.date) ? "date" : null;
    if (raison) return void refusees.push({ ligne: i + 1, raison });
    const v = { siren: siren!, montant: Math.round(e.montant * 100) / 100, date: e.date || null };
    const cle = JSON.stringify(v);
    const rang = rangs.get(cle) ?? 0;
    rangs.set(cle, rang + 1);
    const ref = e.reference?.trim().slice(0, 120);
    lues.set(ref ? `ref:${ref}` : reference(v, rang), v);
  });
  const refs = [...lues.keys()];
  const sirens = [...new Set([...lues.values()].map((v) => v.siren))];
  const r = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ventes:${tenantId}`}, 0))`;
      const deja = refs.length ? new Map((await tx.atlasVente.findMany({ where: { tenantId, reference: { in: refs } } })).map((v) => [v.reference, v])) : new Map();
      const neuves = refs.filter((x) => !deja.has(x));
      if ((await tx.atlasVente.count({ where: { tenantId } })) + neuves.length > VENTES_MAX) throw new FiltreInvalide(`${VENTES_MAX.toLocaleString("fr-FR")} ventes au plus par espace.`);
      const connus = new Set((await tx.atlasClient.findMany({ where: { tenantId, siren: { in: sirens } }, select: { siren: true } })).map((c) => c.siren));
      const clients = sirens.filter((s) => !connus.has(s));
      if ((await tx.atlasClient.count({ where: { tenantId } })) + clients.length > CLIENTS_MAX) throw new FiltreInvalide(`${CLIENTS_MAX.toLocaleString("fr-FR")} clients au plus par espace.`);
      const ligne = (x: string) => ({ siren: lues.get(x)!.siren, montant: lues.get(x)!.montant, date: lues.get(x)!.date ? new Date(lues.get(x)!.date!) : null });
      await tx.atlasVente.createMany({ data: neuves.map((x) => ({ tenantId, reference: x, ajoutePar: auteur, ...ligne(x) })) });
      let changees = 0;
      for (const x of refs.filter((y) => deja.has(y))) {
        const a = deja.get(x)!, n = ligne(x);
        if (a.siren === n.siren && Number(a.montant) === n.montant && (a.date?.getTime() ?? null) === (n.date?.getTime() ?? null)) continue;
        await tx.atlasVente.update({ where: { tenantId_reference: { tenantId, reference: x } }, data: n });
        changees++;
      }
      if (clients.length) await tx.atlasClient.createMany({ data: clients.map((siren) => ({ tenantId, siren, ajoutePar: auteur })), skipDuplicates: true });
      return { ajoutees: neuves.length, changees, clients_ajoutes: clients.length };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  oublierClients(tenantId);
  return { recues: entrees.length, ...r, inchangees: lues.size - r.ajoutees - r.changees, refusees: refusees.length, exemples_refusees: refusees.slice(0, 5), ...(await totaux(tenantId)) };
}

export async function totaux(tenantId: string) {
  const t = await prisma.atlasVente.aggregate({ where: { tenantId }, _count: true, _sum: { montant: true }, _min: { date: true }, _max: { date: true } });
  const j = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  return { ventes: t._count, montant_total: Number(t._sum.montant ?? 0), du: j(t._min.date), au: j(t._max.date) };
}

/** Montant net par client (avoirs déduits). */
export async function montantsParClient(tenantId: string): Promise<Map<string, number>> {
  const l = await prisma.atlasVente.groupBy({ by: ["siren"], where: { tenantId }, _sum: { montant: true } });
  return new Map(l.map((x) => [x.siren, Number(x._sum.montant ?? 0)]));
}

export async function retirerVentes(tenantId: string, quoi: { tous: boolean; references: readonly string[] }) {
  const r = await prisma.atlasVente.deleteMany({ where: { tenantId, ...(quoi.tous ? {} : { reference: { in: quoi.references.map((x) => `ref:${x.trim()}`) } }) } });
  return { retirees: r.count, ...(await totaux(tenantId)) };
}
