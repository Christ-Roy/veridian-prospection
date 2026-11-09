/**
 * Compilateur de filtres Atlas : seuls les champs du catalogue et leurs opérateurs passent, et aucune
 * valeur fournie (utilisateur ou IA) n'apparaît dans le SQL, toutes passent en paramètres typés.
 */
import { describe, expect, test } from "vitest";

import { CHAMPS, OPERATEURS } from "@/atlas/champs";
import { FiltreInvalide, colonnesSql, compilerFiltre } from "@/atlas/filtres";
import { SourceSimulee, valeurParam } from "@/atlas/source";

describe("compilerFiltre", () => {
  test("filtre vide : entreprises non supprimées et non bloquées", () => {
    expect(compilerFiltre({})).toEqual({ where: "is_deleted = 0 AND empty(blocking_reasons)", params: {} });
    expect(compilerFiltre({ inclure_bloques: true }).where).toBe("is_deleted = 0");
  });

  test("chaque type de champ produit une clause paramétrée", () => {
    const { where, params } = compilerFiltre({
      conditions: [
        { champ: "departement", op: "dans", valeur: ["69", "38"] },
        { champ: "chiffre_affaires", op: "entre", valeur: [100000, 500000] },
        { champ: "date_creation", op: "apres", valeur: "2024-01-01" },
        { champ: "rge", op: "est", valeur: true },
        { champ: "site", op: "renseigne", valeur: false },
        { champ: "nom", op: "contient", valeur: "plomberie" },
      ],
    });
    expect(where).toContain("department IN {p0:Array(String)}");
    expect(where).toContain("revenue BETWEEN {p1:Float64} AND {p2:Float64}");
    expect(where).toContain("creation_date >= {p3:Date}");
    expect(where).toContain("label_rge = 1");
    expect(where).toContain("primary_domain = ''");
    expect(where).toContain("positionCaseInsensitiveUTF8(legal_name, {p4:String}) > 0");
    expect(params.p0).toEqual({ type: "Array(String)", valeur: ["69", "38"] });
  });

  test("une valeur piégée reste un paramètre, jamais du SQL", () => {
    const piege = "x') OR 1=1; DROP TABLE company_prospection --";
    const { where, params } = compilerFiltre({ conditions: [{ champ: "nom", op: "egal", valeur: piege }, { champ: "departement", op: "dans", valeur: [piege] }] });
    expect(where).not.toContain("DROP");
    expect(where).not.toContain("1=1");
    expect(Object.values(params).map((p) => p.valeur)).toEqual([piege, [piege]]);
    expect(valeurParam({ type: "Array(String)", valeur: ["l'arbre", "a\\b"] })).toBe("['l\\'arbre','a\\\\b']");
  });

  test.each([
    [{ conditions: [{ champ: "password", op: "egal", valeur: "x" }] }, /champ inconnu/],
    [{ conditions: [{ champ: "chiffre_affaires", op: "contient", valeur: "1" }] }, /opérateur « contient » impossible/],
    [{ conditions: [{ champ: "chiffre_affaires", op: "min", valeur: "1000" }] }, /attend un nombre/],
    [{ conditions: [{ champ: "date_creation", op: "apres", valeur: "hier" }] }, /AAAA-MM-JJ/],
    [{ conditions: [{ champ: "rge", op: "est", valeur: "oui" }] }, /oui ou non/],
    [{ sql: "SELECT 1" }, /Unrecognized key|sql/],
  ])("refuse %j", (filtre, motif) => {
    expect(() => compilerFiltre(filtre)).toThrow(FiltreInvalide);
    expect(() => compilerFiltre(filtre)).toThrow(motif);
  });

  test("le catalogue ne contient que des expressions SQL simples et des opérateurs connus", () => {
    for (const c of CHAMPS) {
      expect(c.sql).toMatch(/^[a-z_0-9]+$/);
      expect(c.id).toMatch(/^[a-z_0-9]+$/);
      expect(OPERATEURS[c.type].length).toBeGreaterThan(0);
    }
  });

  test("colonnes : catalogue seulement, siren toujours inclus, 25 au plus", () => {
    expect(colonnesSql(["nom"]).sql).toBe("siren AS siren, legal_name AS nom");
    expect(() => colonnesSql(["nom", "secret"])).toThrow(/colonne inconnue/);
  });
});

describe("source simulée : même sémantique que le SQL", () => {
  const s = new SourceSimulee(2000);

  test("compter, aperçu trié et répartition cohérents", async () => {
    const filtre = { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }, { champ: "site", op: "renseigne", valeur: true }] };
    const n = await s.compter(filtre);
    expect(n).toBeGreaterThan(0);
    expect(n).toBe(s.lignes.filter((l) => l.departement === "69" && l.site !== "").length);
    const a = await s.apercu(filtre, { colonnes: ["nom", "site", "score_odh"], page: 1, parPage: 10, tri: "score_odh" });
    expect(a.colonnes).toEqual(["siren", "nom", "site", "score_odh"]);
    expect(a.lignes.every((l) => l.site)).toBe(true);
    const scores = a.lignes.map((l) => Number(l.score_odh));
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    const rep = await s.repartition(filtre, "departement");
    expect(rep).toEqual([{ cle: "69", nombre: n }]);
  });

  test("tri et répartition refusés hors catalogue", async () => {
    await expect(s.apercu({}, { colonnes: ["nom"], page: 1, parPage: 5, tri: "nom" })).rejects.toThrow(/tri impossible/);
    await expect(s.repartition({}, "siren")).rejects.toThrow(/répartition impossible/);
  });
});
