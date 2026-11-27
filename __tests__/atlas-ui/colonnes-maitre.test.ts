/** Base maître (parente, 27/11) : colonnes par défaut qui tiennent à 1 128 px, choix relu du navigateur, Nom en tête, Contact composé. */
import { describe, expect, test } from "vitest";

import { COLONNES_MAITRE_DEFAUT, contactConnu, lireColonnesMaitre } from "@/components/atlas/logique";

describe("lireColonnesMaitre", () => {
  test("rien, illisible ou vide : le défaut (Nom, Commune, NAF, Effectif, Contact)", () => {
    for (const brut of [null, "", "{pas du json", "42", "[]", '["inconnue"]']) expect(lireColonnesMaitre(brut), String(brut)).toEqual([...COLONNES_MAITRE_DEFAUT]);
    expect(COLONNES_MAITRE_DEFAUT).toEqual(["nom", "commune", "naf", "effectif", "contact"]);
  });
  test("un choix gardé : colonnes connues seulement, dans l'ordre du catalogue, Nom toujours en tête", () => {
    expect(lireColonnesMaitre('["siren","naf","<script>","departement"]')).toEqual(["nom", "siren", "departement", "naf"]);
    expect(lireColonnesMaitre('["contact","nom"]')).toEqual(["nom", "contact"]);
  });
});

describe("contactConnu", () => {
  test("drapeaux de la base maître, booléens ou 0/1", () => {
    expect(contactConnu({ a_email: true, a_telephone: 1, a_site: "1" })).toBe("Email · Tél. · Site");
    expect(contactConnu({ a_email: false, a_telephone: 0, a_site: true })).toBe("Site");
    expect(contactConnu({ a_email: null })).toBeNull();
  });
});
