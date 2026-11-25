/** Points qui se chevauchent sur la carte : réunis, séparés au zoom, listés quand ils sont à la même adresse. */
import { expect, test } from "vitest";

import { cadreGroupe, LARGEUR_MIN, regrouper, type PointProjete } from "@/components/atlas/carte-logique";

const p = (siren: string, x: number, y: number, email = false): PointProjete => ({ siren, nom: siren, commune: "X", lat: 0, lon: 0, email, site: false, x, y });

test("aucun point perdu, et deux ronds ne se touchent jamais", () => {
  const points = Array.from({ length: 400 }, (_, i) => p(String(i), ((i * 37) % 101) / 10, ((i * 53) % 97) / 10, i % 3 === 0));
  for (const seuil of [0.1, 0.5, 2, 50]) {
    const g = regrouper(points, seuil);
    expect(g.reduce((n, x) => n + x.points.length, 0)).toBe(400);
    expect(new Set(g.flatMap((x) => x.points.map((y) => y.siren))).size).toBe(400);
    for (const [i, a] of g.entries()) for (const b of g.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(seuil);
  }
  expect(regrouper(points, 500)).toHaveLength(1);
});
test("seul, un point reste seul ; l'email compte ; zoomer sépare", () => {
  expect(regrouper([p("a", 0, 0, true), p("b", 5, 5)], 1).map((g) => [g.cle, g.points.length, g.email])).toEqual([["a", 1, 1], ["b", 1, 0]]);
  const proches = [p("a", 0, 0), p("b", 0.5, 0)];
  expect([regrouper(proches, 1).length, regrouper(proches, 0.4).length]).toEqual([1, 2]);
});
test("même adresse : pas de zoom inutile, la liste ; sinon un cadre qui les contient et rapproche", () => {
  const [meme] = regrouper([p("a", 10, 10), p("b", 10.001, 10)], 1);
  expect(cadreGroupe(meme, 100)).toBeNull();
  const [g] = regrouper([p("a", 10, 10), p("b", 12, 11)], 5);
  const c = cadreGroupe(g, 100)!;
  expect(c[0]).toBeLessThan(10);
  expect(c[0] + c[2]).toBeGreaterThan(12);
  expect(c[2]).toBeLessThan(100);
  expect(regrouper(g.points, (c[2] / 150) * 2.4)).toHaveLength(2);
  expect(cadreGroupe(g, LARGEUR_MIN)).toBeNull();
});
