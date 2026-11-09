/**
 * Protocole MCP de Prospection : catalogue filtré par les droits, arguments validés, espace imposé
 * par l'utilisateur (jamais par l'IA), erreurs lisibles, aucun détail technique en cas de panne.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
});
const { panne } = vi.hoisted(() => ({ panne: { active: false } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/atlas/source", async (orig) => {
  const vrai = await orig<typeof import("@/atlas/source")>();
  const simulee = new vrai.SourceSimulee(500);
  const compter = simulee.compter.bind(simulee);
  simulee.compter = async (f: unknown) => {
    if (panne.active) throw new Error("connexion ClickHouse refusée 100.96.29.49:28123");
    return compter(f);
  };
  return { ...vrai, sourceMarche: () => simulee };
});

import { traiter } from "@/lib/mcp/protocole";
import type { UserContext } from "@/lib/auth/user-context";

function ctx(role: "owner" | "admin" | "member" | "viewer", isAdmin = false): UserContext {
  return {
    userId: "u-1",
    email: "u@exemple.fr",
    tenantId: "tenant-A",
    tenantOwnerId: "u-0",
    workspaces: [{ id: "ws-1", name: "Équipe", slug: "equipe", role, visibilityScope: "all" }],
    isAdmin,
    activeWorkspaceId: "ws-1",
  };
}
const c = (role: Parameters<typeof ctx>[0] = "member") => ({ ctx: ctx(role), workspaceId: "ws-1" });
const appel = (name: string, args: unknown) => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
const texte = (r: Awaited<ReturnType<typeof traiter>>) => (r?.result as { content: { text: string }[] }).content[0].text;

beforeEach(() => {
  panne.active = false;
});

describe("MCP Prospection", () => {
  test("initialize annonce les outils et reprend la version du client", async () => {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, c());
    expect(r?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "prospection" } });
  });

  test("une notification ne reçoit pas de réponse", async () => {
    expect(await traiter({ jsonrpc: "2.0", method: "notifications/initialized" }, c())).toBeNull();
  });

  test("un lecteur ne voit pas les outils d'écriture, un membre les voit ; les anciens outils n'existent plus", async () => {
    const noms = async (role: Parameters<typeof ctx>[0]) =>
      ((await traiter({ jsonrpc: "2.0", id: 2, method: "tools/list" }, c(role)))?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(await noms("viewer")).not.toContain("creer_segment");
    expect(await noms("viewer")).toContain("explorer_marche");
    expect(await noms("member")).toContain("creer_segment");
    expect(await noms("member")).not.toContain("rechercher_entreprises");
  });

  test("chaque outil publie un schéma objet et ses annotations", async () => {
    const r = (await traiter({ jsonrpc: "2.0", id: 2, method: "tools/list" }, c()))?.result as {
      tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    };
    for (const t of r.tools) expect(t.inputSchema.type).toBe("object");
    expect(r.tools.find((t) => t.name === "explorer_marche")?.annotations.readOnlyHint).toBe(true);
    expect(r.tools.find((t) => t.name === "creer_segment")?.annotations.readOnlyHint).toBe(false);
  });

  test("un lecteur qui appelle un outil d'écriture reçoit « outil inconnu »", async () => {
    const r = await traiter(appel("creer_segment", { nom: "x", filtre: {} }), c("viewer"));
    expect(r?.error?.message).toMatch(/outil inconnu/);
  });

  test("explorer le marché : un tenant_id passé en argument est ignoré", async () => {
    const r = await traiter(appel("explorer_marche", { filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] }, par_page: 3, tenant_id: "tenant-B" }), c());
    const sortie = JSON.parse(texte(r));
    expect(sortie.total).toBeGreaterThan(0);
    expect(sortie.lignes).toHaveLength(3);
  });

  test("arguments invalides : erreur lisible pour que l'IA corrige", async () => {
    const r = await traiter(appel("fiche_entreprise_atlas", { siren: "12" }), c());
    expect(r?.result).toMatchObject({ isError: true });
    expect(texte(r)).toMatch(/siren/i);
    const f = await traiter(appel("explorer_marche", { filtre: { conditions: [{ champ: "ca", op: "min", valeur: 1 }] } }), c());
    expect(texte(f)).toMatch(/champ inconnu « ca »/);
  });

  test("une panne de la source ne fuit pas le détail technique", async () => {
    panne.active = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = texte(await traiter(appel("explorer_marche", { filtre: {} }), c()));
    expect(t).not.toMatch(/100\.96/);
    expect(t).toMatch(/Erreur interne/);
  });

  test("méthode inconnue : -32601", async () => {
    expect((await traiter({ jsonrpc: "2.0", id: 3, method: "resources/list" }, c()))?.error?.code).toBe(-32601);
  });
});
