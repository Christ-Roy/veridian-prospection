/**
 * IA branchées : chaque requête MCP authentifiée par le Hub (tools/list compris) note le client OAuth et
 * l'heure. Atlas montre ainsi « Claude · dernier échange à 22:31 » au lieu de « aucune IA » dès qu'une IA
 * a parlé à Prospection. Le nom vient du claim `client_name` du jeton quand le Hub le fournit ; sans lui,
 * on n'a que l'identifiant opaque du client (mcpc_…) et on affiche « Assistant IA ». Les IA reliées au Hub
 * mais pas encore venues ici viennent de son endpoint `connexions-ia`.
 */
import { connexionsIaHub, type ConnexionHub } from "@/lib/hub/connexions-ia-client";
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

export type Connexion = { nom: string; depuis: string; dernier_appel: string };

/**
 * Une ligne par IA : celles que le Hub dit reliées (même sans appel encore) et celles qui ont appelé
 * Prospection. Pour chaque nom, la connexion la plus ancienne et l'échange le plus récent.
 */
export function fusionnerConnexions(locales: readonly Connexion[], hub: readonly ConnexionHub[]): Connexion[] {
  const parNom = new Map<string, Connexion>();
  const ajouter = (c: Connexion) => {
    const d = parNom.get(c.nom);
    if (!d) return void parNom.set(c.nom, { ...c });
    if (c.depuis && (!d.depuis || c.depuis < d.depuis)) d.depuis = c.depuis;
    if (c.dernier_appel > d.dernier_appel) d.dernier_appel = c.dernier_appel;
  };
  for (const c of locales) ajouter(c);
  for (const h of hub) ajouter({ nom: h.nom, depuis: h.depuis ?? "", dernier_appel: h.derniere_utilisation ?? h.depuis ?? "" });
  return [...parNom.values()].sort((a, b) => (a.dernier_appel < b.dernier_appel ? 1 : -1));
}

export async function listerPresences(userId: string): Promise<Connexion[]> {
  const [l, u] = await Promise.all([
    prisma.atlasPresenceIa.findMany({ where: { userId }, orderBy: { dernierAppel: "desc" }, take: 10 }),
    prisma.user.findUnique({ where: { id: userId }, select: { hubUserId: true } }),
  ]);
  const locales = l.map((p) => ({ nom: nomClient(p.clientNom), depuis: p.premierAppel.toISOString(), dernier_appel: p.dernierAppel.toISOString() }));
  return fusionnerConnexions(locales, (await connexionsIaHub(u?.hubUserId ?? null)) ?? []);
}

/** Pour les tests : oublie les dernières écritures. */
export function oublierEcritures() {
  derniereEcriture.clear();
}
