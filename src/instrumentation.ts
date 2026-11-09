/**
 * Démarrage du serveur Next, avant toute route : bornes de connexion à PostgreSQL ajoutées à
 * DATABASE_URL pour que chaque PrismaClient en hérite (src/lib/db-bornes.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { appliquerBornesDb } = await import("./lib/db-bornes");
    appliquerBornesDb();
  }
}
