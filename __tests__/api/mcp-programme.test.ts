/**
 * POST /api/mcp appelé par un programme du Hub (CONTRAT-MCP, « Côté app ») : l'en-tête X-Veridian-MCP-Appel vaut pour
 * tous les outils, ne change que la taille de la réponse, et une réponse trop grosse est une erreur, jamais un JSON coupé.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

const { valeur } = vi.hoisted(() => ({ valeur: { v: null as unknown } }));
vi.mock("@/lib/mcp/jeton-hub", async (o) => ({
  ...(await o<typeof import("@/lib/mcp/jeton-hub")>()),
  verifierJetonHub: vi.fn(async (j: string) => {
    if (j !== "bon") throw new (await import("@/lib/mcp/jeton-hub")).JetonRefuse("signature");
    return { hubUserId: "h", email: "a@b.fr", clientNom: "IA" };
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: async () => ({ id: "u", email: "a@b.fr" }) } } }));
vi.mock("@/lib/auth/user-context", () => ({ buildUserContext: async () => ({ userId: "u", tenantId: "t", workspaces: [] }), espaceHub: vi.fn(), resolveInsertWorkspaceId: async () => "w" }));
const limite = vi.hoisted(() => ({ oui: false }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: () => limite.oui }));
vi.mock("@/atlas/presence-ia", () => ({ noterPresence: async () => {} }));
vi.mock("@/atlas/acces", () => ({ droits: async () => ({ accesAvance: false, adminAtlas: false, plan: null, payant: false }) }));
vi.mock("@/lib/mcp/outils", async () => ({
  ErreurOutil: (await import("@/lib/mcp/erreur")).ErreurOutil,
  outilsVisibles: () => [{ name: "gros", title: "g", description: "g", input: z.object({}), annotations: {}, run: async () => valeur.v }],
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/mcp/route";
import { SORTIE_MAX, SORTIE_MAX_PROGRAMME } from "@/lib/mcp/protocole";

const APPEL = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "gros", arguments: {} } };
const post = (entete?: string, corps: unknown = APPEL, jeton = "bon") =>
  POST(new NextRequest("https://p.test/api/mcp", { method: "POST", headers: { authorization: `Bearer ${jeton}`, ...(entete !== undefined ? { "x-veridian-mcp-appel": entete } : {}) }, body: JSON.stringify(corps) }));
const lignes = (n: number, taille = 250) => ({ lignes: Array.from({ length: n }, (_, i) => ({ siren: String(100000000 + i), raison_sociale: "É".repeat(taille / 2) })) });

beforeEach(() => {
  limite.oui = false;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("X-Veridian-MCP-Appel", () => {
  test("programme : 1 000 lignes entières, en structuredContent, une seule fois, sous 1 Mo", async () => {
    valeur.v = lignes(1000);
    const t = await (await post("programme")).text();
    expect(Buffer.byteLength(t)).toBeLessThan(SORTIE_MAX_PROGRAMME);
    const r = JSON.parse(t).result;
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toEqual(valeur.v);
    expect(r.content[0].text.length).toBeLessThan(100); // pas de seconde copie
  });

  test("sans l'en-tête, ou avec une autre valeur : comme avant, coupée avec un avis, sans structuredContent", async () => {
    valeur.v = lignes(1000);
    for (const h of [undefined, "", "Programme", "programme2", "programme, autre", "1"]) {
      const r = (await (await post(h)).json()).result;
      expect(r.structuredContent).toBeUndefined();
      expect(r.content[0].text).toContain(`[réponse tronquée à ${SORTIE_MAX} caractères`);
    }
  });

  test("au-delà de 1 Mo : erreur franche, rien de coupé ; à la limite exacte, ça passe", async () => {
    valeur.v = lignes(5000);
    const t = await (await post("programme")).text();
    const r = JSON.parse(t).result;
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    expect(r.content[0].text).toMatch(/Réponse trop grosse : \d+ octets, 1000000 au plus/);
    const vide = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "Donnée dans structuredContent." }], structuredContent: { x: "" } } }));
    valeur.v = { x: "a".repeat(SORTIE_MAX_PROGRAMME - vide) };
    const juste = await (await post("programme")).text();
    expect(Buffer.byteLength(juste)).toBe(SORTIE_MAX_PROGRAMME);
    expect(JSON.parse(juste).result.isError).toBeUndefined();
    valeur.v = { x: "a".repeat(SORTIE_MAX_PROGRAMME - vide + 1) };
    expect((await (await post("programme")).json()).result.isError).toBe(true);
  });

  test("une valeur qui n'est pas un objet reste du JSON lisible en texte", async () => {
    valeur.v = Array.from({ length: 5000 }, (_, i) => i);
    const r = (await (await post("programme")).json()).result;
    expect(r.structuredContent).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toHaveLength(5000);
  });

  test("ne donne aucun droit : jeton refusé, outil inconnu, débit et lot restent bornés", async () => {
    expect((await post("programme", APPEL, "faux")).status).toBe(401);
    const inconnu = await (await post("programme", { ...APPEL, params: { name: "requete_sql", arguments: {} } })).json();
    expect(inconnu.error.message).toMatch(/outil inconnu/);
    limite.oui = true;
    const d = await post("programme");
    expect(d.status).toBe(429);
    expect(d.headers.get("retry-after")).toBe("5");
    limite.oui = false;
    valeur.v = lignes(1000);
    const lot = await (await post("programme", [APPEL, APPEL])).json();
    expect(lot[0].result.structuredContent).toBeUndefined();
  });
});
