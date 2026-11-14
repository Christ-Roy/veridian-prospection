/**
 * Base maître : un filtre Atlas se traduit champ par champ, le reste est dit (jamais ignoré en silence),
 * le nom se cherche par les mots entiers de sa famille, aucun comptage sans filtre (30 M de lignes), un
 * dépassement des limites du compte devient « trop large » et pas une panne.
 */
import { describe, expect, test } from "vitest";

import { compilerMaitre } from "@/atlas/maitre";
import { SourceClickHouse } from "@/atlas/source";

describe("compilerMaitre", () => {
  test("champs traduits, valeurs en paramètres, entreprises actives par défaut", () => {
    const c = compilerMaitre({
      conditions: [
        { champ: "naf", op: "dans", valeur: ["93.19Z"] },
        { champ: "departement", op: "dans", valeur: ["38"] },
        { champ: "email", op: "renseigne", valeur: true },
        { champ: "date_creation", op: "apres", valeur: "2020-01-01" },
      ],
    });
    expect(c.where).toBe("administrative_status = 'A' AND naf_code IN {q0:Array(String)} AND department IN {q1:Array(String)} AND has_email = 1 AND creation_date >= {q2:Date}");
    expect(c.params.q0.valeur).toEqual(["9319Z"]);
    expect(c.ignorees).toEqual([]);
    expect(c.filtre).toBe(true);
  });

  test("nom : les mots entiers de la famille, jamais un début de mot", () => {
    const c = compilerMaitre({ conditions: [{ champ: "nom", op: "contient", valeur: "Chasseurs" }] });
    expect(c.where).toContain("hasAnyTokens(name_terms, {q0:Array(String)})");
    expect(c.params.q0.valeur).toEqual(expect.arrayContaining(["chasse", "chasseur", "chasseurs"]));
    expect(c.where).not.toContain("name_prefixes");
  });

  test("ce que la base maître n'a pas est rendu dans ignorees ; sans filtre, rien n'est compté", () => {
    const c = compilerMaitre({ conditions: [{ champ: "score_odh", op: "min", valeur: 50 }, { champ: "site", op: "contient", valeur: "x" }] });
    expect(c.ignorees.map((x) => x.champ)).toEqual(["score_odh", "site"]);
    expect(c.filtre).toBe(false);
    expect(c.where).toBe("administrative_status = 'A'");
  });
});

describe("source ClickHouse : base maître", () => {
  const source = (reponse: (sql: string) => Response) => {
    const sql: string[] = [];
    const s = new SourceClickHouse({ url: "http://ch.test/", user: "u", password: "p" }, (async (_u: URL, init: RequestInit) => {
      sql.push(String(init.body));
      return reponse(String(init.body));
    }) as unknown as typeof fetch, undefined, 1);
    return { s, sql };
  };

  test("compter : jamais sans filtre ; trop large pour le compte = null, pas une panne", async () => {
    const { s, sql } = source(() => new Response("Code: 158. DB::Exception: Limit for rows (controlled by 'max_rows_to_read' setting) exceeded", { status: 500 }));
    expect(await s.compterMaitre({})).toBeNull();
    expect(sql).toHaveLength(0);
    expect(await s.compterMaitre({ conditions: [{ champ: "departement", op: "dans", valeur: ["75"] }] })).toBeNull();
    const autre = source(() => new Response("Code: 62. Syntax error", { status: 500 }));
    await expect(autre.s.compterMaitre({ conditions: [{ champ: "naf", op: "dans", valeur: ["7500Z"] }] })).rejects.toThrow(/Syntax/);
  });

  test("lister : colonnes de la base maître, drapeaux en vrai/faux, aucune coordonnée", async () => {
    const { s, sql } = source(() =>
      new Response(JSON.stringify({ data: [{ siren: "812611853", nom: "LES CHASSES DE DIANE", enseigne: "", a_email: 1, a_telephone: "0", a_site: 1, prospectable: 0 }] })),
    );
    const r = await s.listerMaitre({ conditions: [{ champ: "naf", op: "dans", valeur: ["9319Z"] }] }, 2, 20);
    expect(sql[0]).toMatch(/FROM odh\.company_master_current WHERE .* ORDER BY rank DESC, siren LIMIT 20 OFFSET 20 FORMAT JSON$/);
    // Seulement des drapeaux (has_email…) : aucune colonne de coordonnée brute n'est lue.
    expect(sql[0]).not.toMatch(/\b(emails|phones|domains|email|phone)\b(?= AS| FROM|,)/);
    expect(r.lignes[0]).toMatchObject({ nom: "LES CHASSES DE DIANE", enseigne: null, a_email: true, a_telephone: false, prospectable: false });
  });
});
