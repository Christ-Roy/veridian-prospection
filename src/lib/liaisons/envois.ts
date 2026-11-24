/**
 * Un geste (un clic) = un identifiant choisi par l'écran, gardé s'il réessaie. La première exécution aboutie d'une étape
 * garde son résultat ; un rejeu le rend sans rappeler la cible. Deux clics simultanés : un seul travaille.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { RefusLiaison, type Cible } from "./erreurs";

/** Au-delà, une étape « en cours » est une exécution morte (redémarrage) : elle se reprend. */
const EN_COURS_MAX_MS = 120_000;

export type Etape = { tenantId: string; userId: string; geste: string; etape: string; cible: Cible; reference: string };

async function prendre(e: Etape): Promise<{ id: string; fait: Record<string, unknown> | null }> {
  const cle = { tenantId_geste_etape: { tenantId: e.tenantId, geste: e.geste, etape: e.etape } };
  // L'index unique décide : de deux clics simultanés, un seul insère.
  const neuf = await prisma.atlasEnvoi.createMany({ data: [{ ...e, etat: "en_cours" }], skipDuplicates: true });
  const l = await prisma.atlasEnvoi.findUniqueOrThrow({ where: cle });
  if (neuf.count) return { id: l.id, fait: null };
  if (l.userId !== e.userId || l.cible !== e.cible || l.reference !== e.reference) throw new RefusLiaison("geste_reutilise", "Cet envoi ne correspond pas au geste d'origine : recommencez.", 409);
  if (l.etat === "fait") return { id: l.id, fait: (l.resultat ?? {}) as Record<string, unknown> };
  if (l.etat === "en_cours" && Date.now() - l.majLe.getTime() < EN_COURS_MAX_MS) throw new RefusLiaison("en_cours", "Cet envoi est déjà en cours.", 409, 5);
  const pris = await prisma.atlasEnvoi.updateMany({ where: { id: l.id, etat: l.etat, majLe: l.majLe }, data: { etat: "en_cours", majLe: new Date() } });
  if (!pris.count) throw new RefusLiaison("en_cours", "Cet envoi est déjà en cours.", 409, 5);
  return { id: l.id, fait: null };
}

export async function uneFois<T extends Record<string, unknown>>(e: Etape, f: (envoiId: string) => Promise<T>): Promise<T & { rejoue?: boolean }> {
  const { id, fait } = await prendre(e);
  if (fait) return { ...(fait as T), rejoue: true };
  try {
    const r = await f(id);
    await prisma.atlasEnvoi.update({ where: { id }, data: { etat: "fait", majLe: new Date(), resultat: r as Prisma.InputJsonValue } });
    return r;
  } catch (err) {
    await prisma.atlasEnvoi
      .update({ where: { id }, data: { etat: "echec", majLe: new Date(), resultat: { code: err instanceof RefusLiaison ? err.code : "erreur" } } })
      .catch(() => undefined);
    throw err;
  }
}
