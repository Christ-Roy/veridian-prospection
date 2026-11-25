/** VER-249, `fiches:N` : N fiches distinctes par jour montrent leurs coordonnées, une liste jamais. Exige DATABASE_URL. */
import { randomUUID } from "node:crypto";
import { afterAll, expect, test, vi } from "vitest";

vi.hoisted(() => Object.assign(process.env, { ATLAS_SIMULE: "1", ATLAS_GRATUIT_COORDONNEES: "fiches:2" }));
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));

import { selonPlan } from "@/atlas/gratuit";
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";
import { sourceMarche } from "@/atlas/source";
import { prisma } from "@/lib/prisma";

const tenantId = randomUUID();
const c = (payant = false) => ({ ctx: { userId: randomUUID(), email: "x@y.invalid", tenantId, tenantOwnerId: null, workspaces: [], isAdmin: true, activeWorkspaceId: null }, workspaceId: null, droits: { accesAvance: false, adminAtlas: false, plan: payant ? "pro" : "freemium", payant } });
const jouer = async (nom: string, a: Record<string, unknown>, payant = false) => JSON.stringify(await selonPlan(OUTILS_ATLAS.find((o) => o.name === nom)!, a, c(payant)));
afterAll(async () => {
  await prisma.compteur.deleteMany({ where: { cle: { contains: tenantId } } });
  await prisma.$disconnect();
});

test("deux fiches montrent leurs coordonnées, la troisième non ; rouvrir une fiche vue ne recompte pas", async () => {
  const s = (await sourceMarche().extraire(Array.from({ length: 3000 }, (_, i) => String(900000000 + i)))).slice(0, 4).map((l) => l.siren);
  const voit = async (siren: string, payant = false) => (await jouer("fiche_entreprise_atlas", { siren }, payant)).includes("@");
  expect([await voit(s[0]), await voit(s[0]), await voit(s[1]), await voit(s[2]), await voit(s[0]), await voit(s[2])]).toEqual([true, true, true, false, true, false]);
  expect(await voit(s[3], true)).toBe(true);
  expect(await jouer("explorer_marche", { filtre: { conditions: [{ champ: "email", op: "renseigne", valeur: true }] }, colonnes: ["nom", "email"], page: 1, par_page: 10 })).not.toContain("@");
});
