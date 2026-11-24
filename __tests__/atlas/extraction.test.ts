/**
 * extraire_segment (VER-242), partie sans base : le SQL n'extrait que des fiches envoyables et jamais une exclue,
 * le curseur se décode strictement. La stabilité et le quota sont éprouvés sur PostgreSQL (e2e/integration).
 */
import { describe, expect, test, vi } from "vitest";

import { decoderCurseur, encoderCurseur } from "@/atlas/extraction";
import { SourceClickHouse } from "@/atlas/source";

function source(reponses: unknown[][]) {
  const requetes: string[] = [];
  const f = vi.fn(async (_u: unknown, o: { body: string }) => {
    requetes.push(o.body);
    return Response.json({ data: reponses.shift() ?? [] });
  });
  return { requetes, s: new SourceClickHouse({ url: "http://x/", user: "u", password: "p" } as never, f as never) };
}

describe("SQL de l'extraction", () => {
  test("seules les fiches envoyables, avec email, jamais une exclue même si le segment les montre", async () => {
    const { s, requetes } = source([[{ siren: "1", version: "R1" }, { siren: "1", version: "R1" }, { siren: "2", version: "R1" }], [{ n: "7" }]]);
    const r = await s.sirensEnvoyables({ conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }], inclure_bloques: true }, null, 35000);
    expect(r).toEqual({ sirens: ["1", "2"], total: 7, version: "R1" });
    for (const q of requetes) {
      expect(q).toContain("empty(blocking_reasons)");
      expect(q).toContain("(email_envoyable = 1 AND deliverable = 1)");
      expect(q).toContain("email != ''");
    }
    expect(requetes.some((q) => /ORDER BY [\s\S]*siren LIMIT 35000/.test(q))).toBe(true);
  });

  test("chaque page relit l'état courant : une fiche devenue exclue ou non envoyable ne sort pas", async () => {
    const { s, requetes } = source([[{ siren: "1", email: "a@b.fr", raison_sociale: "X", telephone: "", domaine: "b.fr" }]]);
    const [l] = await s.extraire(["1", "2"]);
    expect(l).toMatchObject({ siren: "1", email: "a@b.fr", domaine: "b.fr", telephone: null });
    expect(requetes[0]).toContain("empty(blocking_reasons)");
    expect(requetes[0]).toContain("(email_envoyable = 1 AND deliverable = 1)");
    expect(requetes[0]).toContain("if((telephone_envoyable = 1 AND deliverable = 1), phone, '')");
    expect(await s.extraire([])).toEqual([]);
  });
});

test("curseur : aller-retour, et tout le reste refusé", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  expect(decoderCurseur(encoderCurseur(id, 1000))).toEqual({ extractionId: id, debut: 1000 });
  for (const c of ["", "abc", Buffer.from(`${id}.-1`).toString("base64url"), Buffer.from(`${id}.1; DROP`).toString("base64url")]) expect(decoderCurseur(c)).toBeNull();
});
