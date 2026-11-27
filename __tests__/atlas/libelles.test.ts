/** Dictionnaire unique des libellés de valeurs : formes juridiques, départements, NAF, énumérations ODH, saisie libre. */
import { describe, expect, test } from "vitest";

import { cleDepuisSaisie, formaterDate, libelleAvecCode, libelleValeur, titreValeur, valeurCorrespond } from "@/atlas/libelles";

describe("libelleValeur", () => {
  test("convention collective : les valeurs d'échappement de la DARES sont dites en français (66 639 fiches, 27/11)", () => {
    expect(libelleValeur("idcc", "Sans convention collective ou hors champ conventionnel (valeur d'echappement)")).toBe("Aucune (hors champ conventionnel)");
    expect(libelleValeur("idcc", "Valeur d'echappement (convention non codifiee)")).toBe("Convention non codifiée");
    expect(libelleValeur("idcc", "Convention collective nationale des hôtels, cafés restaurants (HCR)")).toBe("Convention collective nationale des hôtels, cafés restaurants (HCR)");
  });
  test("formes juridiques INSEE, clés forme_juridique et forme", () => {
    const attendu: Record<string, string> = { "1000": "Entrepreneur individuel", "5499": "SARL", "5498": "EURL", "5710": "SAS", "5720": "SASU", "5485": "SELARL", "5785": "SELAS", "5202": "SNC", "9220": "Association déclarée", "6540": "SCI" };
    for (const [code, l] of Object.entries(attendu)) expect(libelleValeur("forme_juridique", code), code).toBe(l);
    expect(libelleValeur("forme_juridique", "catégorie 5485")).toBe("SELARL");
    expect(libelleValeur("forme_juridique", "0000")).toBe("0000");
    expect(libelleValeur("forme", "societe")).toBe("Société");
    expect(libelleValeur("forme", "5710")).toBe("SAS");
  });
  test("départements, NAF, division, effectif", () => {
    expect(libelleValeur("departement", "69")).toBe("Rhône (69)");
    expect(libelleValeur("departement", "2A")).toBe("Corse-du-Sud (2A)");
    expect(libelleValeur("departement", "974")).toBe("La Réunion (974)");
    expect(libelleValeur("departement", "")).toBe("Département inconnu");
    expect(libelleValeur("naf", "0149Z")).toBe("0149Z · Élevage d'autres animaux");
    expect(libelleValeur("naf", "01.49z")).toBe("0149Z · Élevage d'autres animaux");
    expect(libelleValeur("naf_division", "01")).toContain("01 · ");
    expect(libelleValeur("effectif", "NN")).toBe("Non renseignée");
    expect(libelleValeur("effectif", "11")).toBe("10 à 19 salariés");
  });
  test("énumérations ODH, clés de la fiche comprises", () => {
    expect(libelleValeur("taille", "micro")).toBe("Micro-entreprise");
    expect(libelleValeur("niveau_web", "obsolete")).toBe("Obsolète");
    expect(libelleValeur("niveau", "obsolete")).toBe("Obsolète");
    expect(libelleValeur("tendance_ca", "growth_strong")).toBe("Forte croissance");
    expect(libelleValeur("email_verification", "n_existe_pas")).toBe("Boîte inexistante");
    expect(libelleValeur("preuve", "web_disparu")).toBe("Email retiré du site");
    expect(libelleValeur("messagerie", "google")).toBe("Google");
    expect(libelleValeur("grade", "a_requalifier")).toBe("À requalifier");
    expect(libelleValeur("secteur", "BTP")).toBe("BTP");
  });
  test("puce et infobulle gardent le code", () => {
    expect(libelleAvecCode("forme_juridique", "5710")).toBe("SAS · 5710");
    expect(libelleAvecCode("departement", "69")).toBe("Rhône (69)");
    expect(titreValeur("forme_juridique", "5710")).toBe("Société par actions simplifiée (code 5710)");
    expect(titreValeur("grade", "or")).toBe("Or (or)");
  });
});

describe("saisie libre", () => {
  test("un libellé ou un code tapé devient la clé", () => {
    expect(cleDepuisSaisie("forme_juridique", "SAS")).toBe("5710");
    expect(cleDepuisSaisie("forme_juridique", "ei")).toBe("1000");
    expect(cleDepuisSaisie("forme_juridique", "5710")).toBe("5710");
    expect(cleDepuisSaisie("departement", "Rhône")).toBe("69");
    expect(cleDepuisSaisie("departement", "rhone")).toBe("69");
    expect(cleDepuisSaisie("departement", "2a")).toBe("2A");
    expect(cleDepuisSaisie("naf", "01.49z")).toBe("0149Z");
    expect(cleDepuisSaisie("forme_juridique", "inconnu du dico")).toBe("inconnu du dico");
  });
  test("recherche par code ou morceau de libellé, sans accents", () => {
    expect(valeurCorrespond("departement", "69", "rhon")).toBe(true);
    expect(valeurCorrespond("departement", "69", "ain")).toBe(false);
    expect(valeurCorrespond("forme_juridique", "5710", "5710")).toBe(true);
    expect(valeurCorrespond("forme_juridique", "5710", "")).toBe(true);
  });
  test("date", () => expect(formaterDate("2024-01-31T00:00:00")).toBe("31/01/2024"));
});
