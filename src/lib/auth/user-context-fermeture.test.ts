/**
 * Multi-instance (27/11) : une suspension faite sur une AUTRE instance ne vide pas le cache de celle-ci. Le contrôle
 * de fermeture doit donc être relu en base à chaque résolution, pas seulement dans les 3 s du cache.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenant: null as null | { id: string; userId: string; status: string; deletedAt: Date | null },
}));

vi.mock("@/lib/auth-config", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      // Imite le filtre OUVERT : supprimé ou suspendu = introuvable.
      findFirst: async () => {
        const t = state.tenant;
        return t && !t.deletedAt && t.status !== "suspended" ? { id: t.id, userId: t.userId } : null;
      },
      findUnique: async () => null,
    },
    workspaceMember: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    workspace: { findFirst: async () => null },
  },
}));

import { buildUserContext } from "@/lib/auth/user-context";
import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";

describe("contexte en cache : une fermeture faite ailleurs est vue tout de suite", () => {
  beforeEach(() => {
    invalidateAllUserContexts();
    state.tenant = { id: "t-fermeture", userId: "u-fermeture", status: "active", deletedAt: null };
  });

  it("un espace suspendu sur une autre instance refuse aussitôt, même avec un cache chaud", async () => {
    const user = { id: "u-fermeture", email: "f@example.test" };
    expect(await buildUserContext(user, null)).not.toBeNull(); // cache chaud sur cette instance
    state.tenant!.status = "suspended"; // suspension faite ailleurs : ce process n'a pas été invalidé
    expect(await buildUserContext(user, null)).toBeNull();
  });
});
