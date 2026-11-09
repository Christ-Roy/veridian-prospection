/**
 * Taille du marché (cube ODH-0245) : sélection par liste de codes, jamais d'intervalle ni de valeur
 * concaténée dans le SQL, traduction honnête d'un segment (ce que le cube ne couvre pas est dit),
 * libellés lisibles, et réponse ClickHouse correctement relue.
 */
import { describe, expect, test } from "vitest";

import { compilerCube, entreeDepuisFiltre, libelleCube } from "@/atlas/cube";
import { FiltreInvalide } from "@/atlas/filtres";
import { NAF_LIBELLES, normaliserNaf } from "@/atlas/naf";
import { SourceClickHouse, SourceSimulee } from "@/atlas/source";

const ELEVEURS = ["0141Z", "0142Z", "0143Z", "0145Z", "0146Z", "0147Z", "0149Z", "0150Z"];

describe("compilerCube", () => {
  test("codes NAF en liste paramétrée, NAF rév. 2 seulement, actifs par défaut", () => {
    const c = compilerCube({ naf: ["01.49Z", "0142z"] });
    expect(c.params.naf.valeur).toEqual(["0149Z", "0142Z"]);
    expect(c.total).toContain("naf_rev2 = 1");
    expect(c.total).toContain("naf_code IN {naf:Array(String)}");
    expect(c.total).not.toMatch(/BETWEEN|<=|>=/);
    expect(c.params.statut.valeur).toBe("actif");
    expect(c.repartition).toBeNull();
    expect(compilerCube({ statut: "tous" }).total).not.toContain("statut");
  });

  test("une valeur piégée est refusée ou reste un paramètre, jamais du SQL", () => {
    expect(() => compilerCube({ naf: ["0149Z' OR 1=1 --"] })).toThrow(FiltreInvalide);
    expect(() => compilerCube({ departements: ["69'; DROP"] })).toThrow(FiltreInvalide);
    expect(() => compilerCube({ axe: "siren" })).toThrow(FiltreInvalide);
    const c = compilerCube({ naf: ["0149Z"], departements: ["69", "2A"], axe: "departement" });
    expect(c.repartition).not.toContain("69");
    expect(c.repartition).toMatch(/GROUP BY cle ORDER BY entreprises DESC, cle LIMIT 120$/);
  });

  test("une liste vide ne sélectionne rien (jamais tout le marché)", () => {
    expect(compilerCube({ naf: [] }).total).toMatch(/AND 0/);
    expect(compilerCube({ departements: [] }).total).toMatch(/AND 0/);
  });

  test("années de création et divisions", () => {
    const c = compilerCube({ divisions: ["01"], creation_min: 2020, creation_max: 2024 });
    expect(c.total).toContain("substring(naf_code, 1, 2) IN {div:Array(String)}");
    expect(c.params.amin).toEqual({ type: "UInt16", valeur: 2020 });
    expect(c.params.amax).toEqual({ type: "UInt16", valeur: 2024 });
  });
});

describe("segment Atlas → cube", () => {
  test("les axes du cube passent, le reste est rendu dans ignorees", () => {
    const { entree, ignorees } = entreeDepuisFiltre({
      conditions: [
        { champ: "naf", op: "dans", valeur: ELEVEURS },
        { champ: "departement", op: "dans", valeur: ["69", "38"] },
        { champ: "date_creation", op: "apres", valeur: "2020-01-01" },
        { champ: "site", op: "renseigne", valeur: false },
        { champ: "date_creation", op: "avant", valeur: "2024-06-15" },
      ],
    });
    expect(entree).toEqual({ naf: ELEVEURS, departements: ["69", "38"], creation_min: 2020 });
    expect(ignorees.map((c) => c.champ)).toEqual(["site", "date_creation"]);
  });

  test("deux conditions sur le même axe se croisent", () => {
    const { entree } = entreeDepuisFiltre({ conditions: [{ champ: "naf", op: "dans", valeur: ["0149Z", "0142Z"] }, { champ: "naf", op: "dans", valeur: ["0149Z"] }] });
    expect(entree.naf).toEqual(["0149Z"]);
    const vide = entreeDepuisFiltre({ conditions: [{ champ: "naf", op: "dans", valeur: ["0149Z"] }, { champ: "naf", op: "dans", valeur: ["0142Z"] }] });
    expect(compilerCube(vide.entree).total).toMatch(/AND 0/);
  });

  test("« hors » ne se traduit pas : ignoré plutôt que mal compté", () => {
    const { entree, ignorees } = entreeDepuisFiltre({ conditions: [{ champ: "naf", op: "hors", valeur: ["0149Z"] }] });
    expect(entree.naf).toBeUndefined();
    expect(ignorees).toHaveLength(1);
  });
});

describe("libellés", () => {
  test("NAF officiels, département inconnu ou étranger, année inconnue", () => {
    expect(Object.keys(NAF_LIBELLES)).toHaveLength(732);
    expect(libelleCube("naf", "0149Z")).toBe("Élevage d'autres animaux");
    expect(libelleCube("naf", "014A")).toBe("014A");
    expect(libelleCube("departement", "")).toMatch(/inconnu/);
    expect(libelleCube("departement", "99")).toBe("Étranger");
    expect(libelleCube("annee_creation", "0")).toMatch(/inconnue/);
    expect(normaliserNaf("01.49z")).toBe("0149Z");
    expect(normaliserNaf("014A")).toBeNull();
  });
});

describe("source ClickHouse : marche()", () => {
  test("deux requêtes paramétrées sur le cube, mesures et provenance relues", async () => {
    const corps: string[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      corps.push(String(init.body));
      expect(url.searchParams.get("param_naf")).toBe("['0149Z']");
      const total = { entreprises: "77822", email_connu: "3043", email_envoyable: "2367", cube_version: "1794260052", calcule_le: "2026-11-09 21:35:22", version_prospection: "20261109018" };
      const rep = [{ cle: "", entreprises: "14530", email_connu: "7" }, { cle: "59", entreprises: "1716", email_connu: "86" }];
      return new Response(JSON.stringify({ data: String(init.body).includes("GROUP BY") ? rep : [total] }));
    }) as unknown as typeof fetch;
    const s = new SourceClickHouse({ url: "http://ch.test/", user: "u", password: "p" }, fetchImpl);
    const r = await s.marche({ naf: ["0149Z"], axe: "departement" });
    expect(corps.every((c) => c.includes("FROM odh.market_cube_current WHERE naf_rev2 = 1"))).toBe(true);
    expect(r.total.entreprises).toBe(77822);
    expect(r.total.email_envoyable).toBe(2367);
    expect(r.total.telephone_connu).toBe(0);
    expect(r.lignes[0]).toMatchObject({ cle: "", libelle: expect.stringMatching(/inconnu/), entreprises: 14530 });
    expect(r.provenance).toEqual({ cube_version: "1794260052", calcule_le: "2026-11-09 21:35:22", version_prospection: "20261109018" });
  });
});

describe("source simulée : marche()", () => {
  test("même validation qu'en prod, répartition cohérente avec le total", async () => {
    const s = new SourceSimulee(1500);
    const r = await s.marche({ naf: ["0149Z", "4322A"], axe: "naf" });
    expect(r.total.entreprises).toBe(s.lignes.filter((l) => l.naf === "0149Z" || l.naf === "4322A").length);
    expect(r.lignes.reduce((a, l) => a + l.entreprises, 0)).toBe(r.total.entreprises);
    await expect(s.marche({ naf: ["01-49"] })).rejects.toThrow(FiltreInvalide);
  });
});
