/** Logique pure de l'interface Atlas : carte (zone, projection, cadrage), fiche, flux marché → cible, présence de l'IA. */
import { describe, expect, test } from "vitest";

import {
  bornes,
  cadrageDescente,
  chaleur,
  COS_LAT,
  departementsFiltre,
  interpolerCadre,
  normaliserDepartement,
  projeterPoints,
  rang,
  titreZone,
  valeursCarte,
} from "@/components/atlas/carte-logique";
import { enteteFiche, estVide, formaterEuros, formaterSiren, themesFiche } from "@/components/atlas/fiche-logique";
import {
  avecDepartement,
  ciblesDe,
  diffFiltres,
  estMarche,
  etapeCourante,
  etapesEntonnoir,
  fusionnerIAs,
  joursEnvoi,
  kpisDisponibles,
  marcheDe,
  nomAuteur,
  phraseActivite,
  quand,
  sectionsRail,
  segmentsChanges,
} from "@/components/atlas/flux";
import { indexerChamps } from "@/components/atlas/logique";
import { COLONNES_MARCHE, etiquetteLigne, part } from "@/components/atlas/marche";
import { PREMIERE_DEMANDE, boutonsIA, montrerAccueil } from "@/components/atlas/ia";
import { REGLES_SUGGEREES, lignesDepuis, suggestionsRestantes } from "@/components/atlas/lignes";
import type { Arbre, ChampInfo, PointCarte, SegmentArbre } from "@/components/atlas/types";

const NOMS = { "69": "Rhône", "38": "Isère", "01": "Ain", "75": "Paris", "13": "Bouches-du-Rhône" };
const champ = (id: string, type: ChampInfo["type"], operateurs: string[], libelle = id): ChampInfo => ({ id, libelle, type, groupe: "G", operateurs, repartition: false });
const IDX = indexerChamps([
  champ("departement", "liste", ["dans", "hors", "renseigne"], "Département"),
  champ("site", "texte", ["egal", "contient", "renseigne"], "Site web"),
  champ("email", "texte", ["egal", "contient", "renseigne"], "Email"),
  champ("dirigeant", "texte", ["egal", "contient", "renseigne"], "Dirigeant"),
  champ("email_verification", "liste", ["dans", "hors", "renseigne"], "Vérification de l'email"),
  champ("email_envoyable", "oui_non", ["est"], "Email envoyable"),
]);

describe("zone géographique", () => {
  test("France sans condition, région entière par son nom, départements sinon", () => {
    expect(titreZone([], NOMS)).toBe("France");
    const ara = ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"];
    expect(titreZone(ara, NOMS)).toBe("Auvergne-Rhône-Alpes");
    expect(titreZone([...ara, "75"], NOMS)).toBe("Auvergne-Rhône-Alpes, Paris");
    expect(titreZone(["69", "38"], NOMS)).toBe("Rhône, Isère");
    expect(titreZone(["69", "38", "01", "75", "13"], NOMS)).toBe("Rhône, Isère et 3 autres");
  });
  test("départements lus du filtre, normalisés ; « hors » ignoré", () => {
    expect(normaliserDepartement("1")).toBe("01");
    expect(normaliserDepartement("2a")).toBe("2A");
    const f = { conditions: [{ champ: "departement", op: "dans", valeur: ["1", "69"] }, { champ: "departement", op: "hors", valeur: ["38"] }] };
    expect(departementsFiltre(f)).toEqual(["01", "69"]);
  });
});

describe("carte", () => {
  test("dégradé bleu borné, rang à 0,5 si toutes égales", () => {
    expect(chaleur(0)).toBe("hsl(217 30% 95%)");
    expect(chaleur(1)).toBe("hsl(217 90% 40%)");
    expect(chaleur(5)).toBe("hsl(217 90% 40%)");
    expect(chaleur(Number.NaN)).toBe("hsl(217 30% 95%)");
    expect(rang(5, 5, 5)).toBe(0.5);
    expect(rang(7, 5, 9)).toBe(0.5);
  });
  test("cadrage de la descente : marge de 12 % et ratio 800 × 850", () => {
    const [x, y, w, h] = cadrageDescente({ x: 100, y: 200, width: 100, height: 50 });
    expect(w / h).toBeCloseTo(800 / 850);
    expect(w).toBeCloseTo(124);
    expect(x + w / 2).toBeCloseTo(150);
    expect(y + h / 2).toBeCloseTo(225);
  });
  test("interpolation : départ, arrivée, sortie cubique", () => {
    expect(interpolerCadre([0, 0, 800, 850], [100, 100, 200, 200], 0)).toEqual([0, 0, 800, 850]);
    expect(interpolerCadre([0, 0, 800, 850], [100, 100, 200, 200], 1)).toEqual([100, 100, 200, 200]);
    expect(interpolerCadre([0], [100], 0.5)[0]).toBeCloseTo(87.5);
  });
  test("valeurs par département : nombre, puis part en %", () => {
    const total = [{ cle: "69", nombre: 200 }, { cle: "1", nombre: 50 }];
    expect([...valeursCarte(total, null)]).toEqual([["69", 200], ["01", 50]]);
    expect(valeursCarte(total, [{ cle: "69", nombre: 50 }]).get("69")).toBe(25);
    expect(valeursCarte(total, [{ cle: "69", nombre: 50 }]).get("01")).toBe(0);
    expect(bornes([3, 1, 2])).toEqual({ min: 1, max: 3 });
    expect(bornes([])).toBeNull();
  });
});

describe("projection des points dans le chemin du département", () => {
  const p = (siren: string, lon: number, lat: number): PointCarte => ({ siren, nom: siren, commune: "", lon, lat, email: false, site: false });
  const boite = { x: 100, y: 100, width: 200, height: 200 };

  test("la boîte des points remplit la boîte du chemin sans déformation (cos 46°)", () => {
    const r = projeterPoints([p("a", 4, 45), p("b", 5, 46)], boite);
    // largeur corrigée = cos 46° (< 1 degré de latitude) : la hauteur fixe l'échelle
    expect(r[1].y).toBeCloseTo(100); // nord en haut
    expect(r[0].y).toBeCloseTo(300);
    const largeur = r[1].x - r[0].x;
    expect(largeur).toBeCloseTo(200 * COS_LAT);
    expect((r[0].x + r[1].x) / 2).toBeCloseTo(200); // centré
  });
  test("la latitude seule bouge le y, la longitude seule le x", () => {
    const r = projeterPoints([p("a", 4, 45), p("b", 4, 46), p("c", 5, 45)], boite);
    expect(r[0].x).toBeCloseTo(r[1].x);
    expect(r[0].y).toBeCloseTo(r[2].y);
    expect(r[2].x).toBeGreaterThan(r[0].x);
    expect(r[1].y).toBeLessThan(r[0].y);
  });
  test("un seul point au centre ; coordonnées invalides retirées", () => {
    expect(projeterPoints([p("a", 4, 45)], boite)).toMatchObject([{ x: 200, y: 200 }]);
    expect(projeterPoints([p("a", Number.NaN, 45)], boite)).toEqual([]);
  });
  test("au-delà de 20 points, une adresse aberrante n'écrase pas les autres et reste affichée", () => {
    const pts = Array.from({ length: 199 }, (_, i) => p(String(i), 4 + (i % 10) / 10, 45 + Math.floor(i / 10) / 20));
    pts.push(p("loin", 20, 60));
    const r = projeterPoints(pts, boite);
    expect(r).toHaveLength(200);
    const dedans = r.filter((x) => x.siren !== "loin");
    const xs = dedans.map((x) => x.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
    const loin = r.find((x) => x.siren === "loin")!;
    expect(loin.x).toBeGreaterThan(300);
  });
});

describe("fiche entreprise", () => {
  const fiche = {
    identite: { siren: "123456789", nom: "Martin", forme_juridique: "SARL", date_creation: "2019-03-04", capital: null },
    activite: { activite: "Plomberie", secteur: "BTP" },
    lieu: { commune: "Lyon", departement: "69", latitude: 45.7, longitude: 4.8 },
    contact: { email: "contact@martin.fr", telephone: "04 72 00 00 00", messagerie: "" },
    web: { site: "martin.fr", https: false, domaines: [] as string[] },
    finances: { chiffre_affaires: 1_250_000, croissance_pct: 4.5 },
    signaux: { rge: false, qualiopi: true, marches_publics: 0 },
    groupe: { maison_mere: null },
  };
  test("thèmes dans l'ordre, valeurs vides masquées, coordonnées masquées", () => {
    const t = themesFiche(fiche);
    expect(t.map((x) => x.id)).toEqual(["identite", "activite", "lieu", "contact", "web", "finances", "signaux"]);
    const lieu = t.find((x) => x.id === "lieu")!;
    expect(lieu.lignes.map((l) => l.cle)).toEqual(["commune", "departement"]);
    const contact = t.find((x) => x.id === "contact")!;
    expect(contact.lignes.map((l) => l.cle)).toEqual(["email", "telephone"]);
    expect(contact.lignes[0].lien).toBe("mailto:contact@martin.fr");
    expect(contact.lignes[1].lien).toBe("tel:0472000000");
  });
  test("formats : SIREN, date, euros, pourcentage, oui/non ; signaux absents masqués", () => {
    const t = themesFiche(fiche);
    const id = t.find((x) => x.id === "identite")!;
    expect(id.lignes.find((l) => l.cle === "siren")!.texte).toBe("123 456 789");
    expect(id.lignes.find((l) => l.cle === "date_creation")!.texte).toBe("04/03/2019");
    const fin = t.find((x) => x.id === "finances")!;
    expect(fin.lignes[0].texte).toBe("1,3 M€");
    expect(fin.lignes[1].texte).toBe("+4,5 %");
    expect(t.find((x) => x.id === "web")!.lignes.map((l) => [l.cle, l.texte])).toEqual([
      ["site", "martin.fr"],
      ["https", "Non"],
    ]);
    expect(t.find((x) => x.id === "web")!.lignes[0].lien).toBe("https://martin.fr");
    expect(t.find((x) => x.id === "signaux")!.lignes.map((l) => l.cle)).toEqual(["qualiopi"]);
  });
  test("vide : null, texte blanc, liste vide ; faux seulement dans les signaux", () => {
    expect(estVide(null)).toBe(true);
    expect(estVide("  ")).toBe(true);
    expect(estVide([" "])).toBe(true);
    expect(estVide(false, "web")).toBe(false);
    expect(estVide(false, "signaux")).toBe(true);
    expect(estVide(0, "finances")).toBe(false);
  });
  test("en-tête et formats isolés", () => {
    expect(enteteFiche(fiche)).toEqual({ titre: "SARL Martin", sous: "Plomberie · Lyon (69)" });
    expect(enteteFiche({}, "Repli")).toEqual({ titre: "Repli", sous: "" });
    expect(formaterEuros(950)).toBe("950 €");
    expect(formaterEuros(48_000)).toBe("48 k€");
    expect(formaterSiren("12345")).toBe("12345");
  });
});

const seg = (id: string, nom: string, parent: string | null, dossier: string | null = null, version = 1, scoring: number | null = null): SegmentArbre => ({ id, nom, parent_id: parent, dossier_id: dossier, version, scoring });
const ARBRE: Arbre = {
  dossiers: [
    { id: "d1", nom: "Agriculture", parent_id: null },
    { id: "d2", nom: "Élevage", parent_id: "d1" },
    { id: "d3", nom: "Vide", parent_id: null },
  ],
  segments: [
    seg("m1", "Éleveurs de France", null, "d2"),
    seg("c1", "Bovins", "m1", "d2"),
    seg("c2", "Bovins Rhône", "c1", "d2"),
    seg("c3", "Ovins", "m1", "d2"),
    seg("m2", "Plombiers", null, null),
    seg("o1", "Orphelin", "disparu", null),
  ],
};

describe("flux marché → cible", () => {
  test("un marché est un segment racine ; un parent disparu fait d'un segment un marché", () => {
    expect(estMarche(ARBRE.segments[0], ARBRE)).toBe(true);
    expect(estMarche(ARBRE.segments[1], ARBRE)).toBe(false);
    expect(estMarche(ARBRE.segments[5], ARBRE)).toBe(true);
  });
  test("marché d'une cible profonde, cibles à plat avec profondeur", () => {
    expect(marcheDe(ARBRE, "c2")?.id).toBe("m1");
    expect(marcheDe(ARBRE, "m2")?.id).toBe("m2");
    expect(ciblesDe(ARBRE, "m1").map((c) => [c.segment.id, c.profondeur])).toEqual([
      ["c1", 1],
      ["c2", 2],
      ["c3", 1],
    ]);
  });
  test("boucle de parents : pas de récursion infinie", () => {
    const boucle: Arbre = { dossiers: [], segments: [seg("a", "A", "b"), seg("b", "B", "a")] };
    expect(ciblesDe(boucle, "a").length).toBeLessThanOrEqual(1);
    expect(() => marcheDe(boucle, "a")).not.toThrow();
  });
  test("sections du rail : chemin du dossier, dossiers vides omis, « Sans dossier » à la fin", () => {
    expect(sectionsRail(ARBRE).map((s) => [s.nom, s.marches.map((m) => m.id)])).toEqual([
      ["Agriculture › Élevage", ["m1"]],
      ["Sans dossier", ["m2", "o1"]],
    ]);
  });
  test("étape courante", () => {
    expect(etapeCourante(null, null, false)).toBe("marche");
    expect(etapeCourante(ARBRE, "m1", false)).toBe("marche");
    expect(etapeCourante(ARBRE, "c1", false)).toBe("cible");
    expect(etapeCourante(ARBRE, "c1", true)).toBe("priorite");
  });
});

describe("versions et présence de l'IA", () => {
  test("diff de filtres en phrases", () => {
    const a = { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] };
    const b = { conditions: [{ champ: "site", op: "renseigne", valeur: false }], inclure_bloques: true };
    expect(diffFiltres(null, b, IDX)).toEqual(["création"]);
    expect(diffFiltres(a, b, IDX)).toEqual(["+ Site web non renseigné", "− Département parmi 69", "+ bloquées incluses"]);
    expect(diffFiltres(a, a, IDX)).toEqual(["sans changement de filtre"]);
  });
  test("nom de l'auteur", () => {
    expect(nomAuteur("ia:claude-ai")).toBe("Claude");
    expect(nomAuteur("ia:chatgpt")).toBe("ChatGPT");
    expect(nomAuteur("ia:mon-agent")).toBe("Mon-agent");
    expect(nomAuteur("ia:")).toBe("IA");
    expect(nomAuteur("ckx123")).toBe("Interface");
  });
  test("changements entre deux relevés : version, scoring, nouveau ; rien au premier relevé", () => {
    const avant = [seg("a", "A", null, null, 1), seg("b", "B", null, null, 2, 1)];
    const apres = [seg("a", "A", null, null, 2), seg("b", "B", null, null, 2, 2), seg("c", "C", null)];
    expect(segmentsChanges(null, apres)).toEqual([]);
    const ch = segmentsChanges(avant, apres);
    expect(ch.map((c) => [c.id, c.scoring, c.nouveau, c.apres])).toEqual([
      ["a", false, false, 2],
      ["b", true, false, 2],
      ["c", false, true, 1],
    ]);
    expect(phraseActivite("Claude", ch[0])).toBe("Claude a modifié « A » (v2)");
    expect(phraseActivite("Claude", ch[1])).toBe("Claude a revu la priorité de « B » (v2)");
    expect(phraseActivite("Claude", ch[2])).toBe("Claude a créé « C »");
    expect(segmentsChanges(apres, apres)).toEqual([]);
  });
});

describe("priorité : règles simples", () => {
  test("les suggestions portent sur des champs du catalogue et disparaissent une fois utilisées", () => {
    const idx = indexerChamps([champ("email_envoyable", "oui_non", ["est"]), champ("telephone", "texte", ["egal", "contient", "renseigne"])]);
    expect(suggestionsRestantes([], idx).map((r) => r.id)).toEqual(["email_envoyable", "telephone"]);
    const lignes = lignesDepuis([{ champ: "email_envoyable", op: "est", valeur: true, poids: 3 }]);
    expect(suggestionsRestantes(lignes, idx).map((r) => r.id)).toEqual(["telephone"]);
  });
  test("chaque règle suggérée est une condition valide de son champ, avec des points positifs", async () => {
    const { CHAMP, OPERATEURS } = await import("@/atlas/champs");
    for (const r of REGLES_SUGGEREES) {
      const c = CHAMP.get(r.condition.champ);
      expect(c, r.id).toBeDefined();
      expect(OPERATEURS[c!.type]).toContain(r.condition.op);
      expect(r.points).toBeGreaterThan(0);
    }
  });
});

describe("brancher une IA depuis Atlas", () => {
  const liens = { url: "https://app.veridian.site/api/mcp", claude: "https://claude.ai/x", chatgpt: "https://chatgpt.com/#settings/Connectors", cursor: null, vscode: "https://vscode.dev/x", claudeCode: null, aideChatgpt: null };
  test("Claude d'abord, seulement les boutons dont le Hub donne le lien ; aucun sans liens", () => {
    expect(boutonsIA(liens).map((b) => b.id)).toEqual(["claude", "chatgpt", "vscode"]);
    expect(boutonsIA(null)).toEqual([]);
  });
  test("accueil : espace sans marché, une seule fois ; jamais avant d'avoir lu l'arbre", () => {
    expect(montrerAccueil(0, false)).toBe(true);
    expect(montrerAccueil(0, true)).toBe(false);
    expect(montrerAccueil(3, false)).toBe(false);
    expect(montrerAccueil(null, false)).toBe(false);
  });
  test("la première demande dit quoi faire dans Atlas", () => {
    expect(PREMIERE_DEMANDE).toMatch(/Atlas/);
    expect(PREMIERE_DEMANDE).toMatch(/marché/);
  });
});

describe("IA branchées", () => {
  const maintenant = new Date(2026, 10, 9, 22, 40);
  test("les IA actives de la session d'abord, puis les branchées, une ligne par nom", () => {
    const session = [{ nom: "Claude", heure: "22:35", etat: "active" as const }];
    const connexions = [
      { nom: "Claude", depuis: "", dernier_appel: new Date(2026, 10, 9, 22, 30).toISOString() },
      { nom: "ChatGPT", depuis: "", dernier_appel: new Date(2026, 10, 7, 9, 5).toISOString() },
    ];
    expect(fusionnerIAs(session, connexions, maintenant)).toEqual([
      { nom: "Claude", heure: "22:35", etat: "active" },
      { nom: "ChatGPT", heure: "07/11", etat: "branchee" },
    ]);
    expect(fusionnerIAs([], [], maintenant)).toEqual([]);
  });
  test("heure le jour même, date sinon, rien si la date est illisible", () => {
    expect(quand(new Date(2026, 10, 9, 8, 5).toISOString(), maintenant)).toBe("08:05");
    expect(quand(new Date(2026, 9, 31, 8, 5).toISOString(), maintenant)).toBe("31/10");
    expect(quand("pas une date", maintenant)).toBe("");
  });
  test("un identifiant OAuth opaque ne s'affiche jamais", () => {
    expect(nomAuteur("ia:mcpc_KqLKNSlHyGzUgCXS5gk")).toBe("Assistant IA");
    expect(nomAuteur("ia:Claude")).toBe("Claude");
  });
});

describe("taille du marché", () => {
  test("part : arrondie, « < 1 % » plutôt qu'un 0 trompeur, « – » sans total", () => {
    expect(part(6710, 346420)).toBe("2 %");
    expect(part(7, 14530)).toBe("< 1 %");
    expect(part(0, 100)).toBe("0 %");
    expect(part(5, 0)).toBe("–");
  });
  test("étiquette : code et libellé NAF, libellé seul sinon", () => {
    expect(etiquetteLigne("0149Z", "Élevage d'autres animaux")).toBe("0149Z · Élevage d'autres animaux");
    expect(etiquetteLigne("69", "69")).toBe("69");
    expect(etiquetteLigne("", "Département inconnu (adresse non diffusée)")).toBe("Département inconnu (adresse non diffusée)");
  });
  test("connu et envoyable sont deux colonnes distinctes", () => {
    const ids = COLONNES_MARCHE.map((c) => c.id);
    expect(ids).toContain("email_connu");
    expect(ids).toContain("email_envoyable");
  });
});

describe("chiffres et entonnoir", () => {
  test("chiffres clés selon le catalogue", () => {
    expect(kpisDisponibles(IDX).map((k) => k.id)).toEqual(["total", "email", "envoyable", "dirigeant"]);
    expect(kpisDisponibles(indexerChamps([])).map((k) => k.id)).toEqual(["total"]);
  });
  test("jours d'envoi et descente", () => {
    expect(joursEnvoi(0)).toBe(0);
    expect(joursEnvoi(401)).toBe(2);
    expect(avecDepartement({ conditions: [] }, "69").conditions).toEqual([{ champ: "departement", op: "dans", valeur: ["69"] }]);
    expect(avecDepartement({ conditions: [] }, null).conditions).toEqual([]);
  });
  test("entonnoir : base héritée, puis une condition de plus à chaque étape, plafonné", () => {
    const h = [{ champ: "departement", op: "dans", valeur: ["69"] }];
    const p = [
      { champ: "site", op: "renseigne", valeur: false },
      { champ: "email", op: "renseigne", valeur: true },
    ];
    const e = etapesEntonnoir(p, h, false, IDX);
    expect(e.map((x) => x.libelle)).toEqual(["Marché", "Site web non renseigné", "Email renseigné"]);
    expect(e[2].filtre.conditions).toHaveLength(3);
    expect(etapesEntonnoir([], [], false, IDX).map((x) => x.libelle)).toEqual(["Toutes les entreprises"]);
    const beaucoup = Array.from({ length: 10 }, () => p[0]);
    const c = etapesEntonnoir(beaucoup, [], true, IDX, 4);
    expect(c).toHaveLength(4);
    expect(c[3].filtre.conditions).toHaveLength(10);
    expect(c[3].libelle).toMatch(/et 7 autres$/);
    expect(c[3].filtre.inclure_bloques).toBe(true);
  });
});
