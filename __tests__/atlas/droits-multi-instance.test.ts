/**
 * Multi-instance (27/11) : le cache des droits Atlas vit dans chaque process. Un retrait d'accès avancé doit être
 * vu par l'autre instance au plus tard 3 s après, pas 30 s.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({
  tenants: new Map<string, { accesAvance: boolean; plan: string | null }>(),
  users: new Map<string, { atlasAdmin: boolean }>(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: async ({ where }: { where: { id: string } }) => db.tenants.get(where.id) ?? null },
    user: { findUnique: async ({ where }: { where: { id: string } }) => db.users.get(where.id) ?? null },
    workspaceMember: { findFirst: async () => null },
  },
}));

import { droits } from "@/atlas/acces";

describe("droits Atlas : retard borné entre instances (27/11)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    db.tenants.set("t-d", { accesAvance: true, plan: "pro" });
    db.users.set("u-d", { atlasAdmin: false });
  });
  afterEach(() => vi.useRealTimers());

  test("un retrait d'accès avancé ailleurs est vu au plus tard après 3 s", async () => {
    expect((await droits("u-d", "t-d")).accesAvance).toBe(true);
    db.tenants.set("t-d", { accesAvance: false, plan: "freemium" });
    vi.setSystemTime(new Date("2026-11-27T10:00:04Z"));
    expect((await droits("u-d", "t-d")).accesAvance).toBe(false);
  });
});
