/**
 * Helpers de dédupe pour client errors (extrait de /api/errors/route.ts
 * 2026-05-23). Next.js App Router interdit les exports nommés non-HTTP
 * dans un fichier route.ts — d'où ce module séparé.
 *
 * Tests : __tests__/api/errors.test.ts (importe ici).
 */
import { createHash } from "crypto";

/**
 * Clé de dédupe stable pour grouper les erreurs client similaires.
 * SHA1 tronquée à 16 chars (suffit pour un dedupe par paire message+source).
 */
export function computeDedupeKey(
  message: string,
  filename: string | null,
  lineno: number | null,
): string {
  return createHash("sha1")
    .update(`${message}|${filename ?? ""}|${lineno ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Tronque une Date à l'heure UTC pleine (bucket de 1h pour grouper le
 * count d'erreurs identiques).
 */
export function bucketToHour(d: Date): Date {
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    0,
    0,
    0,
  ));
}
