/**
 * Codes NAF d'un métier : radicaux sans accents ni pluriel, libellés officiels, usage réel mesuré sur les
 * noms ; aucune liste figée. La requête ClickHouse reste paramétrée.
 */
import { describe, expect, test } from "vitest";

import { FiltreInvalide } from "@/atlas/filtres";
import { codesParLibelle, motifMot, motsCles, normaliser, validerActivites } from "@/atlas/activites";
import { SourceClickHouse, SourceSimulee } from "@/atlas/source";

describe("mots et libellés", () => {
  test("radicaux : sans accents, pluriels et mots vides retirés", () => {
    expect(normaliser("Élevage")).toBe("elevage");
    expect(motsCles("Les chasseurs")).toEqual(["chass"]);
    expect(motsCles("toilettage pour chiens")).toEqual(["toilett", "chien"]);
    expect(motsCles("éleveurs")).toEqual(["elev"]);
  });
  test("libellés officiels : chasse → 0170Z, élevage de chiens → 0149Z jamais en dur", () => {
    expect(codesParLibelle(motsCles("chasse"))).toContain("0170Z");
    expect(codesParLibelle(motsCles("élevage"))).toEqual(expect.arrayContaining(["0141Z", "0149Z"]));
    expect(codesParLibelle([])).toEqual([]);
  });
  test("mot entier de la famille : chasse, chasseurs oui ; Chasseneuil, châssis non", () => {
    const r = new RegExp(motifMot("chass"));
    for (const ok of ["federation des chasseurs", "societe de chasse", "le chasseur"]) expect(r.test(ok), ok).toBe(true);
    for (const non of ["chasseneuil du poitou", "chassagne montrachet", "garage du chassis"]) expect(r.test(non), non).toBe(false);
    expect(new RegExp(motifMot("toilett")).test("salon de toilettage")).toBe(true);
  });

  test("entrée : 3 lettres au moins, erreur lisible", () => {
    expect(() => validerActivites({ mots: "ab" })).toThrow(FiltreInvalide);
    expect(validerActivites({ mots: "Chasseurs" }).radicaux).toEqual(["chass"]);
  });
});

describe("source", () => {
  test("ClickHouse : mots en paramètres, texte sans accents, comptes du cube par code", async () => {
    const corps: string[] = [];
    const urls: URL[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      corps.push(String(init.body));
      urls.push(url);
      const sql = String(init.body);
      const data = sql.includes("market_cube")
        ? [{ naf: "9319Z", entreprises: "60000", contactables: "900", email: "500" }, { naf: "0170Z", entreprises: "472", contactables: "20", email: "12" }]
        : [{ naf: "9319Z", n: "218" }, { naf: "0170Z", n: "3" }];
      return new Response(JSON.stringify({ data }));
    }) as unknown as typeof fetch;
    const s = new SourceClickHouse({ url: "http://ch.test/", user: "u", password: "p" }, fetchImpl);
    const r = await s.activites(["chass"], ["0170Z"], 10);
    expect(corps[0]).toContain("WITH replaceRegexpAll(normalizeUTF8NFD(lowerUTF8(");
    // Filtre rapide d'abord, mot entier ensuite (sinon plus de 10 s en prod).
    expect(corps[0]).toMatch(/positionUTF8\(t, \{r0:String\}\) > 0 AND match\(t, \{m0:String\}\)/);
    expect(corps[0]).toContain("'\\\\p{Mn}'");
    expect(corps[0]).not.toContain("chass");
    expect(urls[0].searchParams.get("param_m0")).toBe(motifMot("chass"));
    expect(urls[0].searchParams.get("param_r0")).toBe("chass");
    // Le code dont le libellé correspond passe en tête, même avec peu de noms : il n'est jamais coupé par la limite.
    expect(r[0]).toMatchObject({ naf: "0170Z", signaux: ["libelle", "usage"], contactables: 20 });
    expect(r[1]).toMatchObject({ naf: "9319Z", signaux: ["usage"], par_nom: 218, entreprises_actives: 60000 });
  });
  test("simulée : même forme, codes par nom", async () => {
    const r = await new SourceSimulee(300).activites(["simulee"], [], 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].signaux).toContain("usage");
  });
});
