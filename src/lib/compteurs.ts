/**
 * Compteurs en base : un quota ou une limite qui doit survivre à un redémarrage et valoir pour toutes les instances.
 * Une ligne par clé et par fenêtre, incrémentée en une instruction qui refuse de dépasser le plafond : deux appels
 * simultanés ne passent pas tous les deux. Pour un simple confort de débit, `isRateLimited` (mémoire) suffit.
 */
import { prisma } from "@/lib/prisma";

/** Compte `n` si le total reste sous le plafond. Refusé : rien n'est compté, `total` dit où on en est. */
export async function consommer(cle: string, fenetre: Date, n: number, plafond: number): Promise<{ accepte: boolean; total: number }> {
  if (n <= plafond) {
    const r = await prisma.$queryRaw<{ n: number }[]>`
      INSERT INTO compteurs (cle, fenetre, n) VALUES (${cle}, ${fenetre}, ${n})
      ON CONFLICT (cle, fenetre) DO UPDATE SET n = compteurs.n + ${n} WHERE compteurs.n + ${n} <= ${plafond}
      RETURNING n`;
    if (r.length) return { accepte: true, total: r[0].n };
  }
  const l = await prisma.compteur.findUnique({ where: { cle_fenetre: { cle, fenetre } } });
  return { accepte: false, total: l?.n ?? 0 };
}

/** Rend ce qui a été compté pour un travail qui n'a pas abouti. */
export async function rendre(cle: string, fenetre: Date, n: number): Promise<void> {
  await prisma.$executeRaw`UPDATE compteurs SET n = greatest(0, n - ${n}) WHERE cle = ${cle} AND fenetre = ${fenetre}`;
}

/** Minuit à Paris, aujourd'hui, d'après l'horloge de la base (la même pour toutes les instances). */
export async function minuitParis(): Promise<Date> {
  const r = await prisma.$queryRaw<{ j: Date }[]>`SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris') AS j`;
  return r[0].j;
}

/** Fenêtres closes depuis plus de deux jours : appelé de temps en temps, sans tâche planifiée. */
export async function menage(): Promise<void> {
  await prisma.compteur.deleteMany({ where: { fenetre: { lt: new Date(Date.now() - 2 * 24 * 3600 * 1000) } } }).catch(() => undefined);
}

/** Limite de débit en base, fenêtre fixe. Vrai : refuser. */
export async function tropDeRequetes(cle: string, plafond: number, fenetreMs: number): Promise<boolean> {
  const fenetre = new Date(Math.floor(Date.now() / fenetreMs) * fenetreMs);
  const { accepte } = await consommer(cle, fenetre, 1, plafond);
  if (Math.random() < 0.02) void menage();
  return !accepte;
}
