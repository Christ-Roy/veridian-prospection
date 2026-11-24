/**
 * Une IA qui part de zéro (VER-242) : les descriptions lui arrivent entières (la porte du Hub n'en garde que la première
 * ligne, 300 caractères) et chaque erreur dit quoi faire ensuite. Cas relevés en prod le 24/11 avec un vrai client MCP.
 */
import { describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
});
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";
import { compilerFiltre } from "@/atlas/filtres";
import { descriptionServie } from "@/lib/mcp/outils";

const refus = (nom: string, args: object) => {
  const r = OUTILS_ATLAS.find((o) => o.name === nom)!.input.safeParse(args);
  return r.success ? "" : r.error.issues.map((i) => i.message).join(" ; ");
};
const filtre = (f: unknown) => {
  try {
    compilerFiltre(f);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

test("descriptions : 300 caractères au plus sur la première ligne, jamais coupées par la porte", () => {
  for (const o of OUTILS_ATLAS) expect(`${o.name} ${descriptionServie(o).split("\n")[0].length <= 300}`).toBe(`${o.name} true`);
});

test("programme : tout outil d'écriture dit, sur sa première ligne, qu'il est à nommer dans autoriser ; un outil de lecture ne le dit pas", () => {
  const dit = (o: (typeof OUTILS_ATLAS)[number]) => descriptionServie(o).split("\n")[0].includes("à nommer dans autoriser");
  for (const o of OUTILS_ATLAS) expect(`${o.name} ${dit(o)}`).toBe(`${o.name} ${!o.annotations.readOnlyHint || o.annotations.destructiveHint}`);
  expect(OUTILS_ATLAS.filter(dit).map((o) => o.name)).toEqual(expect.arrayContaining(["extraire_segment", "creer_segment", "supprimer_segment", "creer_cle_api"]));
  expect(OUTILS_ATLAS.filter(dit).length).toBeLessThan(OUTILS_ATLAS.length);
});

describe("chaque refus conduit à l'étape suivante", () => {
  test("segment absent ou inventé : où trouver l'identifiant", () => {
    for (const a of [{}, { segment_id: "mannequinat" }, { segment_id: 12 }]) {
      expect(refus("extraire_segment", a)).toMatch(/lister_segments_atlas.*creer_segment/);
      expect(refus("lire_segment", a)).toMatch(/lister_segments_atlas/);
    }
    expect(refus("extraire_segment", { segment_id: "11111111-2222-4333-8444-555555555555" })).toBe("");
  });
  test("limite trop grande, métier absent, filtre absent", () => {
    expect(refus("extraire_segment", { segment_id: "11111111-2222-4333-8444-555555555555", limite: 5000 })).toMatch(/1000 lignes au plus.*curseur_suivant/);
    expect(refus("chercher_activites", {})).toMatch(/métier en quelques mots/);
    expect(refus("creer_segment", { nom: "X" })).toMatch(/"conditions".*lister_champs/);
  });
  test("filtre mal écrit : la bonne forme, le champ voisin, les opérateurs permis", () => {
    expect(filtre({ naf: ["7810Z"] })).toMatch(/clé inconnue « naf ».*"conditions"/);
    expect(filtre({ conditions: [{ champ: "code_naf", op: "dans", valeur: ["7810Z"] }] })).toMatch(/peut-être naf.*lister_champs/);
    expect(filtre({ conditions: [{ champ: "zzz", op: "dans", valeur: ["1"] }] })).toMatch(/champ inconnu « zzz » \(lister_champs/);
    expect(filtre({ conditions: [{ champ: "naf", op: "egal", valeur: "7810Z" }] })).toMatch(/dans, hors, renseigne/);
  });
});

test("« 78.10Z » vaut 7810Z : un segment ne se crée plus vide en silence", () => {
  expect(compilerFiltre({ conditions: [{ champ: "naf", op: "dans", valeur: ["78.10Z", "75.00z", "0149Z"] }] }).params.p0.valeur).toEqual(["7810Z", "7500Z", "0149Z"]);
  expect(compilerFiltre({ conditions: [{ champ: "departement", op: "dans", valeur: ["2A"] }] }).params.p0.valeur).toEqual(["2A"]);
});
