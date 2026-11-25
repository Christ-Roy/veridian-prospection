/** PDF écrit à la main et noms de routes de l'API par marché : pur. */
import { describe, expect, test } from "vitest";

import { cheminsOpenApi, nommer, slug } from "@/atlas/api-marches";
import { chaine, couper, largeur, lignes, MARGE, Pdf } from "@/atlas/pdf";
import { phrase } from "@/atlas/rapport";

describe("pdf", () => {
  test("accents, euro et parenthèses ; rien ne sort de la chaîne ; inconnu = ?", () => {
    expect(chaine("Éleveurs (canins) \\ 3 €")).toBe("(\\311leveurs \\(canins\\) \\\\ 3 \\200)");
    expect(chaine("a\nb\u0000c 中 12 500")).toBe("(a b c ? 12\\240500)");
    expect(chaine(") Tj ET (")).toBe("(\\) Tj ET \\()");
  });
  test("table des positions exacte, plusieurs pages, longueurs justes", () => {
    const p = new Pdf();
    for (let i = 0; i < 120; i++) p.paragraphe(`Ligne ${i} é`);
    const s = p.octets("Titre", "Pied").toString("latin1");
    const debut = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(debut, debut + 4)).toBe("xref");
    const pos = [...s.slice(debut).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
    pos.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const n = Number(/\/Count (\d+)/.exec(s)![1]);
    expect(n).toBeGreaterThan(1);
    expect(s.match(/\/Type \/Page /g)).toHaveLength(n);
    for (const m of s.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(m[2].length).toBe(Number(m[1]));
  });
  test("rien ne dépasse la largeur : coupe et retour à la ligne, mot immense compris", () => {
    expect(largeur(couper("x".repeat(500), 9, 100), 9)).toBeLessThanOrEqual(100);
    for (const l of lignes(`un ${"mot".repeat(200)} deux trois`, 10, 200)) expect(largeur(l, 10)).toBeLessThanOrEqual(200);
    expect(lignes("a\n\nb", 10, 100)).toEqual(["a", "", "b"]);
    expect(MARGE).toBeGreaterThan(30);
  });
  test("phrases de la définition", () => {
    expect(phrase({ champ: "departement", op: "dans", valeur: ["69", "38"] })).toMatch(/^Département : /);
    expect(phrase({ champ: "naf", op: "dans", valeur: Array.from({ length: 9 }, (_, i) => `011${i}Z`) })).toMatch(/et 3 autres$/);
    expect(phrase({ champ: "client", op: "est", valeur: false })).toBe("Est déjà client : non");
  });
});

describe("routes par marché", () => {
  const S = (id: string, nom: string, parent_id: string | null = null) => ({ id, nom, parent_id });
  test("nom lisible, stable, unique", () => {
    expect([slug("Éleveurs canins"), slug("Cœur & âme"), slug("???")]).toEqual(["eleveurs-canins", "coeur-ame", "marche"]);
    const l = nommer([S("b1111111-x", "Marché"), S("a1111111-x", "marché", "b1111111-x"), S("c", "openapi.json")]);
    expect(l.map((m) => [m.chemin, m.type])).toEqual([["marche-b1111111", "marche"], ["marche", "cible"], ["openapi-json", "marche"]]);
  });
  test("trois routes par marché, une de plus dès qu'un marché naît", () => {
    const o = cheminsOpenApi("https://x/api/v1/marches", nommer([S("a", "Restaurants")]));
    expect(Object.keys(o.paths)).toEqual(["/", "/restaurants", "/restaurants/repartition", "/restaurants/entreprises"]);
    expect(Object.keys(cheminsOpenApi("https://x", nommer([S("a", "Restaurants"), S("b", "Hôtels")])).paths)).toHaveLength(7);
  });
});
