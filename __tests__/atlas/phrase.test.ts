/**
 * VER-130 : une phrase devient un filtre Atlas, sans modèle de langage. Chaque condition dit le morceau de phrase qui
 * l'a produite ; ce qui n'est pas compris est rendu, jamais transformé en condition au hasard.
 */
import { describe, expect, test } from "vitest";

import { compilerFiltre } from "@/atlas/filtres";
import { analyserPhrase, codesMetier, proposerVue, tranchesEntre, type ChercheActivites } from "@/atlas/phrase";

const JOUR = new Date("2026-11-26T12:00:00Z");
const cond = (phrase: string, champ: string) => analyserPhrase(phrase, JOUR).compris.find((c) => c.condition.champ === champ)?.condition;

describe("zone", () => {
  test("département par nom, par numéro, par ville, région entière", () => {
    expect(cond("plombiers en Isère", "departement")?.valeur).toEqual(["38"]);
    expect(cond("boulangers dans le 69 et 01", "departement")?.valeur).toEqual(["69", "01"]);
    expect(cond("garages autour de Lyon", "departement")?.valeur).toEqual(["69"]);
    expect(cond("architectes en Bretagne", "departement")?.valeur).toEqual(["22", "29", "35", "56"]);
    expect(cond("toiletteurs en Haute-Savoie et Savoie", "departement")?.valeur).toEqual(expect.arrayContaining(["74", "73"]));
    expect(cond("cavistes en Pays de la Loire", "departement")?.valeur).toEqual(["44", "49", "53", "72", "85"]);
  });
  test("un nom de département qui est un mot courant ne devient un lieu qu'après « dans le », « en »…", () => {
    expect(cond("vente par lot de matériel", "departement")).toBeUndefined();
    expect(cond("rien de cher", "departement")).toBeUndefined();
    expect(cond("menuisiers dans le Lot", "departement")?.valeur).toEqual(["46"]);
    expect(cond("couvreurs du Nord", "departement")?.valeur).toEqual(["59"]);
  });
  test("un nombre de salariés n'est pas un département", () => {
    expect(cond("plombiers de 10 à 49 salariés", "departement")).toBeUndefined();
  });
});

describe("taille", () => {
  test("tranches SIRENE entières, sinon celles qui chevauchent", () => {
    expect(tranchesEntre(10, 49)).toEqual(["11", "12"]);
    expect(tranchesEntre(15, 30)).toEqual(["11", "12"]);
  });
  test("bornes chiffrées et noms usuels", () => {
    expect(cond("plombiers de 10 à 49 salariés", "effectif")?.valeur).toEqual(["11", "12"]);
    expect(cond("imprimeurs de plus de 50 salariés", "effectif")?.valeur).toEqual(["21", "22", "31", "32", "41", "42", "51", "52", "53"]);
    expect(cond("agences de moins de 10 salariés", "effectif")?.valeur).toEqual(["00", "01", "02", "03"]);
    expect(cond("PME industrielles", "effectif")?.valeur).toEqual(["11", "12", "21", "22", "31"]);
    expect(cond("TPE du bâtiment", "effectif")?.valeur).toEqual(["00", "01", "02", "03"]);
  });
});

describe("joignabilité, signaux, création", () => {
  test("email, téléphone, site, vente en ligne, labels : paquet cible", () => {
    const a = analyserPhrase("électriciens RGE joignables par email avec un site", JOUR);
    const champs = a.compris.filter((c) => c.paquet === "cible").map((c) => c.condition.champ);
    expect(champs).toEqual(expect.arrayContaining(["email_envoyable", "rge", "site"]));
    expect(cond("fleuristes avec téléphone", "telephone_envoyable")).toEqual({ champ: "telephone_envoyable", op: "est", valeur: true });
    expect(cond("boutiques sans site web", "site")).toEqual({ champ: "site", op: "renseigne", valeur: false });
    expect(cond("organismes de formation certifiés Qualiopi", "qualiopi")?.valeur).toBe(true);
  });
  test("« joignables » seul vaut email envoyable, et le dit", () => {
    const a = analyserPhrase("paysagistes joignables", JOUR);
    expect(a.compris.find((c) => c.condition.champ === "email_envoyable")?.libelle).toMatch(/email/);
  });
  test("création : depuis une année, moins de N ans", () => {
    expect(cond("restaurants créés depuis 2022", "date_creation")).toEqual({ champ: "date_creation", op: "apres", valeur: "2022-01-01" });
    expect(cond("startups de moins de 3 ans", "date_creation")).toEqual({ champ: "date_creation", op: "apres", valeur: "2023-11-26" });
  });
});

describe("métier", () => {
  test("le reste de la phrase est le métier, sans les mots vides", () => {
    expect(analyserPhrase("je cherche des plombiers en Isère de 10 à 49 salariés joignables par email", JOUR).metier).toEqual(["plombiers"]);
  });
  test("sans source : libellé NAF officiel", async () => {
    expect((await codesMetier(["chasse"])).codes).toContain("0170Z");
  });
  test("avec source, l'usage passe avant le libellé : plombiers en 4322A, pas la métallurgie du plomb", async () => {
    const vus: string[][] = [];
    const chercher: ChercheActivites = async (_r, lib) => {
      vus.push([...lib]);
      return [{ naf: "4322A", par_nom: 5000, signaux: ["usage"] }, { naf: "2443Z", par_nom: 1, signaux: ["libelle"] }];
    };
    expect((await codesMetier(["plombiers"], chercher)).codes).toEqual(["4322A"]);
    expect(vus[0]).toContain("2443Z");
  });
  test("sinon l'usage réel : les codes qui portent 90 % des fiches, 8 au plus, sans la traîne", async () => {
    const chercher: ChercheActivites = async () => [
      { naf: "4322A", par_nom: 9000, signaux: ["usage"] },
      { naf: "4322B", par_nom: 800, signaux: ["usage"] },
      { naf: "4399C", par_nom: 300, signaux: ["usage"] },
      { naf: "4711D", par_nom: 2, signaux: ["usage"] },
    ];
    const m = await codesMetier(["plombiers"], chercher);
    expect(m).toMatchObject({ source: "usage" });
    expect(m.codes).toEqual(["4322A", "4322B"]);
  });
});

describe("proposition entière", () => {
  const chercher: ChercheActivites = async () => [{ naf: "4322A", par_nom: 9000, signaux: ["usage"] }];

  test("phrase complète : marché (métier, zone, taille) puis cible (email), nom proposé, filtre valide", async () => {
    const p = await proposerVue("Plombiers en Isère de 10 à 49 salariés joignables par email", chercher, JOUR);
    expect(p.marche.map((c) => c.champ)).toEqual(["naf", "effectif", "departement"]);
    expect(p.cible.map((c) => c.champ)).toEqual(["email_envoyable"]);
    expect(p.nom_propose).toBe("Plombiers · Isère");
    expect(p.non_compris).toEqual([]);
    expect(() => compilerFiltre(p.filtre)).not.toThrow();
  });
  test("un métier introuvable est rendu « non compris », jamais filtré au hasard", async () => {
    const p = await proposerVue("zorglubeurs en Gironde", async () => [], JOUR);
    expect(p.filtre.conditions.map((c) => c.champ)).toEqual(["departement"]);
    expect(p.non_compris).toContain("zorglubeurs");
  });
  test("chaque proposition se compile (paramètres typés, aucun texte concaténé)", async () => {
    for (const phrase of ["PME du Nord avec site", "TPE à Paris créées depuis 2020", "garages dans le 2A", "e-commerce en Occitanie", "rien du tout"]) {
      const p = await proposerVue(phrase, chercher, JOUR);
      expect(() => compilerFiltre(p.filtre), phrase).not.toThrow();
    }
  });
});
