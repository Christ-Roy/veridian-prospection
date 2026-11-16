/**
 * Projection de la carte et communes : un point tombe dans son département, les contours se compactent,
 * les comptes de la base maître (par nom) et des fiches (par INSEE) se rattachent aux bonnes communes.
 */
import { describe, expect, test } from "vitest";

import { DEPARTMENT_PATHS } from "@/components/dashboard/france-map-data";
import { cheminSvg, cleCommune, projeter, simplifier } from "@/atlas/projection";
import { rapprocher, versCommunes, type CommuneGeo } from "@/atlas/communes";
import { cadrageCommune, placerPoints, valeurCommune } from "@/components/atlas/carte-logique";

/** Point dans le chemin d'un département (règle pair-impair sur chaque sous-chemin M…). */
const dedans = (code: string, [x, y]: [number, number]) => {
  let pair = false;
  for (const sous of DEPARTMENT_PATHS[code].split("M").filter(Boolean)) {
    const pts = [...sous.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) pair = !pair;
    }
  }
  return pair;
};

describe("projection de la carte", () => {
  test("une ville tombe dans son département, pas dans le voisin", () => {
    expect(dedans("38", projeter(5.7245, 45.1885))).toBe(true); // Grenoble
    expect(dedans("29", projeter(-4.486, 48.39))).toBe(true); // Brest
    expect(dedans("06", projeter(7.262, 43.71))).toBe(true); // Nice
    expect(dedans("2B", projeter(9.149, 42.306))).toBe(true); // Corte (Ajaccio est sur la côte, hors du trait simplifié)
    expect(dedans("38", projeter(4.835, 45.764))).toBe(false); // Lyon n'est pas en Isère
  });

  test("le nord est en haut, l'est à droite", () => {
    const [xb, yb] = projeter(-4.486, 48.39);
    const [xn, yn] = projeter(7.262, 43.71);
    expect(xn).toBeGreaterThan(xb);
    expect(yn).toBeGreaterThan(yb);
  });

  test("placerPoints écarte les coordonnées absentes", () => {
    const p = { siren: "1", nom: "A", commune: "Grenoble", email: true, site: false };
    expect(placerPoints([{ ...p, lat: 45.19, lon: 5.72 }, { ...p, siren: "2", lat: Number.NaN, lon: 5 }])).toHaveLength(1);
  });
});

describe("contours compacts", () => {
  test("Douglas-Peucker retire les points alignés et garde les coins", () => {
    const l = simplifier([[0, 0], [1, 0.001], [2, 0], [2, 2]], 0.01);
    expect(l).toEqual([[0, 0], [2, 0], [2, 2]]);
  });

  test("chemin relatif au centième, anneau dégénéré écarté", () => {
    const d = cheminSvg([
      [[5, 45], [5.1, 45], [5.1, 45.1], [5, 45]],
      [[5, 45], [5, 45]],
    ]);
    expect(d).toMatch(/^M[\d.]+ [\d.]+(l-?[\d.]+ -?[\d.]+)+z$/);
    expect(d.match(/M/g)).toHaveLength(1);
  });

  test("Paris, Lyon et Marseille sont découpées en arrondissements", () => {
    const carre = (lon: number, lat: number) => ({ type: "Polygon" as const, coordinates: [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat]]] });
    const c = versCommunes([
      { properties: { code: "69123", nom: "Lyon" }, geometry: carre(4.8, 45.7) },
      { properties: { code: "69383", nom: "Lyon 3e Arrondissement", codesPostaux: ["69003"] }, geometry: carre(4.85, 45.75) },
      { properties: { code: "69001", nom: "Affoux" }, geometry: null },
    ]);
    expect(c.map((x) => x.code)).toEqual(["69383"]);
    expect(c[0]).toMatchObject({ cle: "LYON 3", cp: ["69003"] });
    expect(c[0].w).toBeGreaterThan(0);
  });
});

describe("rapprochement des comptes", () => {
  test("même clé pour les graphies d'ODH et de l'État", () => {
    expect(cleCommune("Saint-Martin-d'Hères")).toBe(cleCommune("SAINT-MARTIN-D'HERES"));
    expect(cleCommune("St Martin d'Heres")).toBe("SAINT MARTIN D HERES");
    expect(cleCommune("La Côte-Saint-André")).toBe(cleCommune("La Cote-Saint-Andre"));
    expect(cleCommune("Lyon 3e Arrondissement")).toBe(cleCommune("LYON 3EME"));
    expect(cleCommune("Paris 1er Arrondissement")).toBe("PARIS 1");
  });

  const geo = (code: string, nom: string, cp: string[] = []): CommuneGeo => ({ code, nom, cle: cleCommune(nom), cp, d: "M0 0z", x: 0, y: 0, w: 1, h: 1 });
  const communes = [
    geo("38185", "Grenoble", ["38000", "38100"]),
    geo("38544", "Vienne", ["38200"]),
    geo("69383", "Lyon 3e Arrondissement", ["69003"]),
    geo("73001", "Saint-Jean", ["73100"]),
    geo("73002", "Saint-Jean", ["73200"]),
  ];

  test("base maître : par nom, arrondissement par code postal, homonymes départagés, reste compté à part", () => {
    const r = rapprocher(communes, {
      base: "marche",
      repli: false,
      lignes: [
        { insee: null, nom: "GRENOBLE", code_postal: "38000", mesures: { entreprises: 60, contactables: 11 } },
        { insee: null, nom: "GRENOBLE", code_postal: "38100", mesures: { entreprises: 33, contactables: 6 } },
        { insee: null, nom: "LYON", code_postal: "69003", mesures: { entreprises: 4, contactables: 1 } },
        { insee: null, nom: "SAINT-JEAN", code_postal: "73200", mesures: { entreprises: 2, contactables: 0 } },
        { insee: null, nom: "VILLE FANTOME", code_postal: "38999", mesures: { entreprises: 3, contactables: 1 } },
      ],
    });
    expect(r.communes[0]).toEqual({ code: "38185", nom: "Grenoble", mesures: { entreprises: 93, contactables: 17 } });
    expect(r.communes.find((c) => c.code === "69383")?.mesures.entreprises).toBe(4);
    expect(r.communes.find((c) => c.code === "73002")?.mesures.entreprises).toBe(2);
    expect(r.communes.find((c) => c.code === "73001")).toBeUndefined();
    expect(r.non_rapprochees).toEqual({ entreprises: 3, contactables: 1 });
  });

  test("fiches prospectables : par code INSEE, même si le nom diffère", () => {
    const r = rapprocher(communes, { base: "prospection", repli: false, lignes: [{ insee: "38544", nom: "VIENNE CEDEX", code_postal: null, mesures: { entreprises: 14 } }] });
    expect(r.communes).toEqual([{ code: "38544", nom: "Vienne", mesures: { entreprises: 14 } }]);
  });
});

describe("carte d'une commune", () => {
  test("valeur : nombre ou part des entreprises", () => {
    const m = { entreprises: 40, contactables: 10, email_envoyable: 4 };
    expect(valeurCommune("nombre", m)).toBe(40);
    expect(valeurCommune("contactable", m)).toBe(25);
    expect(valeurCommune("email_envoyable", m)).toBe(10);
    expect(valeurCommune("contactable", { entreprises: 0 })).toBe(0);
  });

  test("un village minuscule est cadré à une taille lisible, centré", () => {
    const [x, y, w, h] = cadrageCommune({ x: 10, y: 20, width: 0.1, height: 0.1 }, 5);
    expect(w).toBeGreaterThanOrEqual(5);
    expect(x + w / 2).toBeCloseTo(10.05);
    expect(y + h / 2).toBeCloseTo(20.05);
  });
});
