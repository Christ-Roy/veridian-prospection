/**
 * Helpers pour le hash + vérification des api_keys tenant (contrat Hub §6.2).
 *
 * Pattern :
 *  - Au provision, on génère un secret en clair (`generateApiKey`), on le
 *    hash (`hashApiKey`), on stocke le hash dans Workspace.apiKeyHash, on
 *    retourne le secret en clair au Hub UNE SEULE FOIS.
 *  - À chaque call generateMagicLink, le Hub envoie Bearer <secret>, on hash
 *    avec la même fonction et on lookup en DB via UNIQUE index.
 *
 * Pourquoi sha256 et pas bcrypt :
 *  - bcrypt = ralentit volontairement (anti brute-force humain sur des
 *    passwords courts faibles). Pertinent pour des mots de passe user.
 *  - Ici on parle d'un secret machine-to-machine de 256 bits d'entropie
 *    (impossible à bruteforcer même avec un GPU). On veut le lookup le plus
 *    rapide possible, donc sha256 hex direct.
 *  - Avantage bonus sha256 : lookup déterministe = on peut indexer en DB et
 *    chercher par hash exact (impossible avec bcrypt dont le salt rendrait
 *    chaque hash différent).
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";

const API_KEY_BYTES = 32; // 32 bytes = 256 bits = 64 chars hex

/**
 * Génère une api_key en clair, conforme à la regex `extractBearerApiKey`
 * (`[A-Za-z0-9_-]{16,256}`). 64 chars hex = 256 bits d'entropie.
 */
export function generateApiKey(): string {
  return randomBytes(API_KEY_BYTES).toString("hex");
}

/**
 * Hash sha256 hex d'une api_key. Déterministe (pas de salt) — c'est ce qui
 * permet le lookup UNIQUE index côté DB.
 */
export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/**
 * Comparaison temps-constant pour éviter les timing attacks. Hash le plain
 * reçu et compare avec le hash stocké via `timingSafeEqual`.
 *
 * Retourne false si les longueurs diffèrent (sha256 hex = 64 chars toujours,
 * donc un hash mal formé en DB est rejeté proprement).
 */
export function verifyApiKey(plain: string, expectedHash: string): boolean {
  const actualHash = hashApiKey(plain);
  if (actualHash.length !== expectedHash.length) return false;
  return timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
}
