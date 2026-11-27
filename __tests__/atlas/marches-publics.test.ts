/** Pages publiques de marché : un code NAF officiel et rien d'autre, que des comptes, gardées, un échec ne reste pas. */
import { beforeEach, expect, test, vi } from "vitest";

const s = vi.hoisted(() => ({ appels: [] as unknown[], panne: false }));
vi.mock("@/atlas/source", () => ({
  sourceMarche: () => ({
    marche: async (e: { axe?: string }) => {
      s.appels.push(e);
      if (s.panne) throw new Error("base muette");
      const total = { entreprises: 100, prospectables: 40, email_envoyable: 20, telephone_envoyable: 30 };
      const l = (cle: string, n: number) => ({ cle, libelle: cle === "69" ? "Rhône" : cle, entreprises: n, email: "x@y.fr" });
      return { total, provenance: null, lignes: e.axe === "departement" ? [l("", 5), l("99", 2), l("69", 60)] : e.axe === "effectif" ? [l("11", 3), l("00", 50)] : e.axe === "naf" ? [l("7500Z", 100), l("", 4)] : [l("2025", 9)] };
    },
  }),
}));
import { _oublier, cheminMarche, lireNaf, marchePublic, marchesPublics } from "@/atlas/marches-publics";
import { isPublicPath } from "@/lib/auth/chemins-publics";

beforeEach(() => {
  _oublier();
  s.appels.length = 0;
  s.panne = false;
});
test("le code, et rien d'autre", () => {
  expect([lireNaf("7500z-activites-veterinaires"), lireNaf("7500Z"), lireNaf("7500z-n-importe-quoi")]).toEqual(["7500Z", "7500Z", "7500Z"]);
  for (const x of ["9999Z", "7500", "7500zz", "7500z'; DROP", "../etc", "constructor", "", "__proto__"]) expect([x, lireNaf(x)]).toEqual([x, null]);
  expect(cheminMarche("7500Z")).toBe("/marche/7500z-activites-veterinaires");
});
test("que des comptes, rangés ; départements inconnus et étranger écartés ; une seule lecture par jour", async () => {
  const [a, b] = await Promise.all([marchePublic("7500Z", 2026), marchePublic("7500Z", 2026)]);
  expect(a).toBe(b);
  expect(s.appels).toHaveLength(3);
  expect(s.appels).toEqual(expect.arrayContaining([{ naf: ["7500Z"], axe: "departement", limite: 120 }]));
  expect(a.departements).toEqual([{ libelle: "Rhône", n: 60 }]);
  expect(a.tailles.map((t) => t.n)).toEqual([50, 3]);
  expect(a.creations.at(-2)).toEqual({ annee: 2025, n: 9 });
  expect(JSON.stringify(a)).not.toContain("@");
  expect(await marchesPublics()).toEqual([{ naf: "7500Z", libelle: "Activités vétérinaires", n: 100 }]);
});
test("une panne se dit, ne se garde pas, et ne martèle pas la base", async () => {
  s.panne = true;
  await expect(marchePublic("7500Z")).rejects.toThrow("base muette");
  await expect(marchePublic("7500Z")).rejects.toThrow("base muette");
  expect(s.appels).toHaveLength(3);
  s.panne = false;
  vi.useFakeTimers({ now: Date.now() + 61_000 });
  expect((await marchePublic("7500Z")).total.entreprises).toBe(100);
  vi.useRealTimers();
});
test("seules ces pages s'ouvrent sans compte", () => {
  for (const p of ["/marches", "/marche/7500z-activites-veterinaires", "/robots.txt", "/sitemap.xml"]) expect([p, isPublicPath(p)]).toEqual([p, true]);
  for (const p of ["/", "/marche", "/marche/a/b", "/marchesX", "/api/v1/marches", "/api/atlas/rapport", "/atlas", "/robots.txtx", "/sitemap.xml/x"]) expect([p, isPublicPath(p)]).toEqual([p, false]);
});
