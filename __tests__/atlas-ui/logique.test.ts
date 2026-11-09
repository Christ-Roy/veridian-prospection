/** Logique pure des écrans Atlas : phrases de filtres, construction d'une condition par type, carte, arbre. */
import { describe, expect, test } from "vitest";

import { lignesDepuis, nouvelleLigne, validerConditions, validerCriteres } from "@/components/atlas/lignes";
import {
  ajouterValeurs,
  colonnesAffichees,
  combiner,
  conditionsHeritees,
  construireArbre,
  construireCondition,
  definirDepartements,
  departementsDuFiltre,
  formaterCellule,
  formaterDate,
  grouperChamps,
  indexerChamps,
  largeurBarre,
  lireNombre,
  phraseCondition,
  phraseFiltre,
  saisieVide,
  sansConditionsDans,
} from "@/components/atlas/logique";
import type { ChampInfo } from "@/components/atlas/types";

const champ = (id: string, type: ChampInfo["type"], operateurs: string[], groupe = "Lieu", libelle = id): ChampInfo => ({ id, libelle, type, groupe, operateurs, repartition: false });
const CHAMPS = [
  champ("departement", "liste", ["dans", "hors", "renseigne"], "Lieu", "Département"),
  champ("nom", "texte", ["egal", "contient", "renseigne"], "Identité", "Nom"),
  champ("chiffre_affaires", "nombre", ["min", "max", "entre", "renseigne"], "Taille et finances", "Chiffre d'affaires (€)"),
  champ("date_creation", "date", ["apres", "avant"], "Identité", "Date de création"),
  champ("ecommerce", "oui_non", ["est"], "Web", "Vente en ligne"),
];
const IDX = indexerChamps(CHAMPS);
const C = (id: string) => IDX.get(id)!;

describe("phrases", () => {
  test("une condition par type", () => {
    expect(phraseCondition({ champ: "departement", op: "dans", valeur: ["69", "01"] }, IDX)).toBe("Département parmi 69, 01");
    expect(phraseCondition({ champ: "chiffre_affaires", op: "entre", valeur: [1000, 5000] }, IDX)).toBe("Chiffre d'affaires (€) entre 1 000 et 5 000");
    expect(phraseCondition({ champ: "date_creation", op: "apres", valeur: "2024-01-31" }, IDX)).toBe("Date de création à partir du 31/01/2024");
    expect(phraseCondition({ champ: "ecommerce", op: "est", valeur: false }, IDX)).toBe("Vente en ligne : non");
    expect(phraseCondition({ champ: "nom", op: "renseigne", valeur: false }, IDX)).toBe("Nom non renseigné");
    expect(phraseCondition({ champ: "nom", op: "contient", valeur: "bois" }, IDX)).toBe("Nom contient « bois »");
  });
  test("liste longue tronquée", () => {
    expect(phraseCondition({ champ: "departement", op: "dans", valeur: ["1", "2", "3", "4", "5", "6"] }, IDX)).toBe("Département parmi 1, 2, 3, 4 et 2 autres");
  });
  test("filtre en une phrase", () => {
    expect(phraseFiltre({ conditions: [] }, IDX)).toBe("Toutes les entreprises");
    expect(
      phraseFiltre({ conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }, { champ: "ecommerce", op: "est", valeur: true }], inclure_bloques: true }, IDX),
    ).toBe("Département parmi 69 et Vente en ligne : oui et bloquées incluses");
  });
  test("champ inconnu : l'id est affiché tel quel", () => {
    expect(phraseCondition({ champ: "zzz", op: "egal", valeur: "a" }, IDX)).toBe("zzz est égal à « a »");
  });
});

describe("construireCondition", () => {
  test("liste : valeurs nettoyées, dédoublonnées, obligatoires", () => {
    expect(construireCondition(C("departement"), "dans", { ...saisieVide(), liste: [" 69 ", "69", "01", ""] })).toEqual({ ok: true, condition: { champ: "departement", op: "dans", valeur: ["69", "01"] } });
    expect(construireCondition(C("departement"), "dans", saisieVide())).toMatchObject({ ok: false });
  });
  test("nombre : virgule, espaces, bornes", () => {
    expect(construireCondition(C("chiffre_affaires"), "min", { ...saisieVide(), min: "1 500,5" })).toEqual({ ok: true, condition: { champ: "chiffre_affaires", op: "min", valeur: 1500.5 } });
    expect(construireCondition(C("chiffre_affaires"), "max", { ...saisieVide(), max: "300" })).toEqual({ ok: true, condition: { champ: "chiffre_affaires", op: "max", valeur: 300 } });
    expect(construireCondition(C("chiffre_affaires"), "entre", { ...saisieVide(), min: "10", max: "20" })).toEqual({ ok: true, condition: { champ: "chiffre_affaires", op: "entre", valeur: [10, 20] } });
    expect(construireCondition(C("chiffre_affaires"), "entre", { ...saisieVide(), min: "20", max: "10" })).toMatchObject({ ok: false });
    expect(construireCondition(C("chiffre_affaires"), "min", { ...saisieVide(), min: "abc" })).toMatchObject({ ok: false });
  });
  test("date : AAAA-MM-JJ réelle uniquement", () => {
    expect(construireCondition(C("date_creation"), "apres", { ...saisieVide(), texte: "2024-02-29" })).toMatchObject({ ok: true });
    expect(construireCondition(C("date_creation"), "apres", { ...saisieVide(), texte: "2023-02-29" })).toMatchObject({ ok: false });
    expect(construireCondition(C("date_creation"), "avant", { ...saisieVide(), texte: "01/01/2024" })).toMatchObject({ ok: false });
  });
  test("oui/non et renseigné donnent un booléen", () => {
    expect(construireCondition(C("ecommerce"), "est", { ...saisieVide(), oui: false })).toEqual({ ok: true, condition: { champ: "ecommerce", op: "est", valeur: false } });
    expect(construireCondition(C("nom"), "renseigne", saisieVide())).toEqual({ ok: true, condition: { champ: "nom", op: "renseigne", valeur: true } });
  });
  test("texte vide refusé, opérateur hors catalogue refusé", () => {
    expect(construireCondition(C("nom"), "contient", { ...saisieVide(), texte: "  " })).toMatchObject({ ok: false });
    expect(construireCondition(C("nom"), "min", saisieVide())).toMatchObject({ ok: false });
  });
  test("aller-retour : une condition rééditée donne la même condition", () => {
    const conds = [
      { champ: "departement", op: "hors", valeur: ["13", "84"] },
      { champ: "chiffre_affaires", op: "entre", valeur: [5, 9] },
      { champ: "date_creation", op: "avant", valeur: "2020-05-01" },
      { champ: "ecommerce", op: "est", valeur: true },
    ];
    const r = validerConditions(lignesDepuis(conds), IDX);
    expect(r).toEqual({ ok: true, valeur: conds });
  });
});

describe("lignes et scoring", () => {
  test("critères : poids obligatoire entre 0,1 et 100", () => {
    const l = nouvelleLigne(C("ecommerce"), "25");
    expect(validerCriteres([l], IDX)).toEqual({ ok: true, valeur: [{ champ: "ecommerce", op: "est", valeur: true, poids: 25 }] });
    expect(validerCriteres([{ ...l, poids: "0" }], IDX)).toMatchObject({ ok: false });
    expect(validerCriteres([{ ...l, poids: "101" }], IDX)).toMatchObject({ ok: false });
    expect(validerCriteres([], IDX)).toMatchObject({ ok: false });
  });
  test("une erreur par ligne invalide", () => {
    const r = validerConditions([nouvelleLigne(C("departement")), nouvelleLigne(C("nom"))], IDX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs).toHaveLength(2);
  });
});

describe("carte et filtres", () => {
  test("la sélection de la carte remplace la condition département", () => {
    const f = { conditions: [{ champ: "ecommerce", op: "est", valeur: true }] };
    const a = definirDepartements(f, ["69", "01"]);
    expect(departementsDuFiltre(a)).toEqual(["69", "01"]);
    expect(definirDepartements(a, ["38"]).conditions).toHaveLength(2);
    expect(definirDepartements(a, []).conditions).toEqual(f.conditions);
  });
  test("la carte garde tous les départements : sa requête ignore la condition département", () => {
    const f = definirDepartements({ conditions: [{ champ: "nom", op: "contient", valeur: "x" }] }, ["69"]);
    expect(sansConditionsDans(f, "departement").conditions).toEqual([{ champ: "nom", op: "contient", valeur: "x" }]);
  });
  test("conditions héritées : celles du segment viennent d'abord dans le filtre effectif", () => {
    const propre = { conditions: [{ champ: "nom", op: "contient", valeur: "a" }] };
    const effectif = { conditions: [...propre.conditions, { champ: "ecommerce", op: "est", valeur: true }] };
    const h = conditionsHeritees(effectif, propre);
    expect(h).toEqual([{ champ: "ecommerce", op: "est", valeur: true }]);
    expect(combiner(propre, h).conditions).toEqual(effectif.conditions);
  });
});

describe("arbre", () => {
  test("dossiers imbriqués, segments enfants, segments sans dossier à la racine", () => {
    const seg = (id: string, dossier_id: string | null, parent_id: string | null = null) => ({ id, nom: id, dossier_id, parent_id, version: 1, scoring: null });
    const t = construireArbre({
      dossiers: [{ id: "d1", nom: "D1", parent_id: null }, { id: "d2", nom: "D2", parent_id: "d1" }],
      segments: [seg("s1", "d1"), seg("s2", "d1", "s1"), seg("s3", "d2"), seg("s4", null), seg("s5", "inconnu")],
    });
    expect(t.map((n) => (n.type === "dossier" ? n.dossier.id : n.segment.id))).toEqual(["d1", "s4", "s5"]);
    const d1 = t[0];
    expect(d1.type === "dossier" && d1.enfants.map((n) => (n.type === "dossier" ? n.dossier.id : n.segment.id))).toEqual(["d2", "s1"]);
    const s1 = d1.type === "dossier" ? d1.enfants[1] : null;
    expect(s1 && s1.enfants).toHaveLength(1);
  });
  test("une boucle de segments parents ne fait pas boucler l'affichage", () => {
    const seg = (id: string, parent_id: string) => ({ id, nom: id, dossier_id: null, parent_id, version: 1, scoring: null });
    expect(() => construireArbre({ dossiers: [], segments: [seg("a", "b"), seg("b", "a")] })).not.toThrow();
  });
});

describe("formats", () => {
  test("nombres, dates, cellules", () => {
    expect(lireNombre("1 000,5")).toBe(1000.5);
    expect(lireNombre("x")).toBeNull();
    expect(formaterDate("2024-03-09")).toBe("09/03/2024");
    expect(formaterCellule(null)).toBe("—");
    expect(formaterCellule(true)).toBe("Oui");
    expect(formaterCellule("2024-03-09", C("date_creation"))).toBe("09/03/2024");
  });
  test("colonne score ajoutée si les lignes en portent un", () => {
    expect(colonnesAffichees(["nom"], [{ nom: "a", score: 5 }])).toEqual(["nom", "score"]);
    expect(colonnesAffichees(["nom", "score"], [{ nom: "a", score: 5 }])).toEqual(["nom", "score"]);
    expect(colonnesAffichees(["nom"], [{ nom: "a" }])).toEqual(["nom"]);
  });
  test("groupes, valeurs multiples, barres", () => {
    expect(grouperChamps(CHAMPS).map((g) => g.groupe)).toEqual(["Lieu", "Identité", "Taille et finances", "Web"]);
    expect(ajouterValeurs(["a"], "b, c;a\nd")).toEqual(["a", "b", "c", "d"]);
    expect(largeurBarre(50, 200)).toBe(25);
    expect(largeurBarre(5, 0)).toBe(0);
  });
});
