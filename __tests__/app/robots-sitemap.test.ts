/** robots.txt et sitemap : fermés sans ATLAS_PUBLIC_INDEX=1 ; ouverts, seules les pages publiques des marchés. */
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/atlas/marches-publics", () => ({
  marchesPublics: async () => [{ naf: "1071C", libelle: "Boulangerie", n: 40572 }],
  cheminMarche: (naf: string) => `/marche/${naf.toLowerCase()}-boulangerie`,
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

afterEach(() => vi.unstubAllEnvs());

test("fermé par défaut : tout interdit, sitemap vide", async () => {
  vi.stubEnv("ATLAS_PUBLIC_INDEX", "");
  expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  expect(await sitemap()).toEqual([]);
});

test("ouvert : les marchés seulement, sitemap annoncé et rempli", async () => {
  vi.stubEnv("ATLAS_PUBLIC_INDEX", "1");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://prospection.app.veridian.site");
  const r = robots();
  expect(r.rules).toEqual({ userAgent: "*", allow: ["/marches", "/marche/"], disallow: ["/", "/api/", "/login"] });
  expect(r.sitemap).toBe("https://prospection.app.veridian.site/sitemap.xml");
  expect((await sitemap()).map((u) => u.url)).toEqual(["https://prospection.app.veridian.site/marches", "https://prospection.app.veridian.site/marche/1071c-boulangerie"]);
});
