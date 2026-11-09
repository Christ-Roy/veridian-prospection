/**
 * Bornes de connexion à PostgreSQL, ajoutées à DATABASE_URL quand elles manquent.
 *
 * Pourquoi (09/11, bascule pg-saas) : pendant une bascule Patroni, HAProxy accepte la connexion TCP
 * alors qu'aucun primaire ne répond. Ces bornes font échouer vite l'OUVERTURE d'une connexion et
 * renouvellent les connexions (Prisma n'expose pas de keepalive TCP).
 *
 * Mesuré (Prisma 6.19, moteur bibliothèque, __tests__/lib/db-bornes.test.ts) : une requête sur une
 * connexion déjà ouverte dont le serveur se tait attend sans fin, `socket_timeout` compris. Ce cas-là
 * est couvert par /api/health (base interrogée en 2 s, 503 sinon) et le `check_restart` du job, qui
 * redémarre l'allocation en une minute environ. `socket_timeout` n'est donc pas posé : il n'agit pas.
 *
 * Appliquées au démarrage du serveur (src/instrumentation.ts) pour couvrir tous les PrismaClient,
 * y compris ceux des routes qui instancient le leur. Une valeur explicite dans l'URL l'emporte.
 */
export const BORNES_DB = {
  // pg-saas : max_connections=100 pour cinq apps ; un seul client Prisma (src/lib/prisma.ts), 8 connexions.
  connection_limit: "8",
  connect_timeout: "10", // s : ouverture d'une connexion (TCP + poignée de main)
  pool_timeout: "10", // s : attente d'une connexion libre dans le pool
  max_connection_lifetime: "1800", // s : une connexion est renouvelée, même active
  max_idle_connection_lifetime: "300", // s : une connexion inutilisée est fermée
} as const;

export function avecBornes(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return url;
  for (const [cle, valeur] of Object.entries(BORNES_DB)) {
    if (!u.searchParams.has(cle)) u.searchParams.set(cle, valeur);
  }
  return u.toString();
}

export function appliquerBornesDb(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DATABASE_URL) env.DATABASE_URL = avecBornes(env.DATABASE_URL);
}
