/**
 * Un retrait ou une suspension vaut pour toutes les instances, canari compris : vider un cache ne touche que l'instance
 * qui reçoit l'appel du Hub, donc la durée des caches de droits borne le retard des autres. Seuil de la recette du
 * Hub : 5 s après l'acquittement (cas 37). Mesuré le 26/11 avec 30 s : retrait lu ouvert 6 à 10 s pendant un canari.
 */
import { expect, test, vi } from "vitest";

vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

test("contexte (espaces, rôle) et compte actif : 3 s au plus", async () => {
  expect((await import("@/lib/auth/user-context")).CACHE_TTL_MS).toBeLessThanOrEqual(3_000);
  expect((await import("@/lib/auth/active-user")).CACHE_TTL_MS).toBeLessThanOrEqual(3_000);
});
