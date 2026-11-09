/**
 * IA branchées : chaque requête MCP authentifiée par le Hub (tools/list compris) note le client OAuth et
 * l'heure. Atlas montre ainsi « Claude · dernier échange à 22:31 » au lieu de « aucune IA » dès qu'une IA
 * a parlé à Prospection. Le nom vient du claim `client_name` du jeton quand le Hub le fournit ; sans lui,
 * on n'a que l'identifiant opaque du client (mcpc_…) et on affiche « Assistant IA ».
 */
import { prisma } from "@/lib/prisma";

/** Une écriture par utilisateur et client toutes les 60 s au plus : un échange fait des dizaines d'appels. */
const INTERVALLE_MS = 60_000;
const derniereEcriture = new Map<string, number>();

export async function noterPresence(userId: string, clientId: string | null, clientNom: string | null, maintenant = Date.now()): Promise<void> {
  if (!clientId) return;
  const cle = `${userId}:${clientId}`;
  if (maintenant - (derniereEcriture.get(cle) ?? 0) < INTERVALLE_MS) return;
  derniereEcriture.set(cle, maintenant);
  const nom = clientNom?.trim().slice(0, 80) || null;
  await prisma.atlasPresenceIa.upsert({
    where: { userId_clientId: { userId, clientId } },
    create: { userId, clientId, clientNom: nom },
    update: { dernierAppel: new Date(maintenant), ...(nom ? { clientNom: nom } : {}) },
  });
}

/** Nom affichable : le nom donné par le Hub, sinon un libellé générique (jamais l'identifiant opaque). */
export function nomClient(clientNom: string | null): string {
  return clientNom?.trim() || "Assistant IA";
}

export async function listerPresences(userId: string) {
  const l = await prisma.atlasPresenceIa.findMany({ where: { userId }, orderBy: { dernierAppel: "desc" }, take: 10 });
  return l.map((p) => ({ nom: nomClient(p.clientNom), depuis: p.premierAppel.toISOString(), dernier_appel: p.dernierAppel.toISOString() }));
}

/** Pour les tests : oublie les dernières écritures. */
export function oublierEcritures() {
  derniereEcriture.clear();
}
