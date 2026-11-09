/**
 * Protocole MCP de Prospection : catalogue filtré par les droits, arguments validés, espace imposé
 * par l'utilisateur (jamais par l'IA), erreurs lisibles.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const { q } = vi.hoisted(() => ({
  q: {
    getLeads: vi.fn(),
    getSegmentLeads: vi.fn(),
    getAllSegmentCounts: vi.fn(),
    patchOutreach: vi.fn(),
    getLeadDetail: vi.fn(),
    recordVisit: vi.fn(),
    consumeLead: vi.fn(),
  },
}));
vi.mock("@/lib/queries", () => q);
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("@/lib/segments", () => ({ getAllSegments: () => [{ id: "rge", label: "RGE", type: "smart" }] }));
vi.mock("@/lib/cache", () => ({ cached: (_k: string, _t: number, f: () => unknown) => f() }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantProspectLimit: vi.fn(async () => 100) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock("@/lib/auth/freeze", () => ({ isUserFrozen: vi.fn(async () => false) }));
vi.mock("@/lib/auth/user-context", () => ({}));

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

beforeEach(() => vi.clearAllMocks());

describe("MCP Prospection", () => {
  test("initialize annonce les outils et reprend la version du client", async () => {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, c());
    expect(r?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "prospection" } });
  });

  test("une notification ne reçoit pas de réponse", async () => {
    expect(await traiter({ jsonrpc: "2.0", method: "notifications/initialized" }, c())).toBeNull();
  });

  test("un lecteur ne voit pas l'outil d'écriture, un membre le voit", async () => {
    const noms = async (role: Parameters<typeof ctx>[0]) =>
      ((await traiter({ jsonrpc: "2.0", id: 2, method: "tools/list" }, c(role)))?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(await noms("viewer")).not.toContain("changer_statut");
    expect(await noms("viewer")).toContain("rechercher_entreprises");
    expect(await noms("member")).toContain("changer_statut");
  });

  test("chaque outil publie un schéma et ses annotations", async () => {
    const r = (await traiter({ jsonrpc: "2.0", id: 2, method: "tools/list" }, c()))?.result as {
      tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    };
    for (const t of r.tools) expect(t.inputSchema.type).toBe("object");
    expect(r.tools.find((t) => t.name === "rechercher_entreprises")?.annotations.readOnlyHint).toBe(true);
    expect(r.tools.find((t) => t.name === "changer_statut")?.annotations.readOnlyHint).toBe(false);
  });

  test("un lecteur qui appelle l'outil d'écriture reçoit « outil inconnu », rien n'est écrit", async () => {
    const r = await traiter(appel("changer_statut", { siren: "123456789", statut: "interesse" }), c("viewer"));
    expect(r?.error?.message).toMatch(/outil inconnu/);
    expect(q.patchOutreach).not.toHaveBeenCalled();
  });

  test("la recherche interroge l'espace de l'utilisateur, jamais celui passé en argument", async () => {
    q.getLeads.mockResolvedValue({ data: [{ domain: "123456789", nom_entreprise: "Plomberie Test" }], total: 1 });
    const r = await traiter(appel("rechercher_entreprises", { departements: ["69"], tenant_id: "tenant-B" }), c());
    expect(q.getLeads).toHaveBeenCalledWith(expect.objectContaining({ filters: { departement: "69" } }), "tenant-A");
    const sortie = JSON.parse((r?.result as { content: { text: string }[] }).content[0].text);
    expect(sortie).toMatchObject({ total: 1, page: 1, page_suivante: null, entreprises: [{ siren: "123456789", nom: "Plomberie Test" }] });
  });

  test("la pagination respecte le plafond du plan", async () => {
    q.getLeads.mockResolvedValue({ data: [{ domain: "1" }], total: 5000 });
    const r = await traiter(appel("rechercher_entreprises", { page: 6, par_page: 20 }), c());
    const sortie = JSON.parse((r?.result as { content: { text: string }[] }).content[0].text);
    expect(sortie).toMatchObject({ total: 100, pages: 5, plafond_du_plan: 100, entreprises: [] });
  });

  test("arguments invalides : erreur lisible, aucune requête", async () => {
    const r = await traiter(appel("fiche_entreprise", { siren: "12" }), c());
    expect(r?.result).toMatchObject({ isError: true });
    expect((r?.result as { content: { text: string }[] }).content[0].text).toMatch(/siren/);
    expect(q.getLeadDetail).not.toHaveBeenCalled();
  });

  test("fiche inconnue : message clair", async () => {
    q.getLeadDetail.mockResolvedValue(null);
    const r = await traiter(appel("fiche_entreprise", { siren: "123456789" }), c());
    expect((r?.result as { content: { text: string }[] }).content[0].text).toMatch(/Aucune entreprise/);
  });

  test("une erreur interne ne fuit pas le détail technique", async () => {
    q.getLeads.mockRejectedValue(new Error("connexion pg-saas refusée 172.26.64.1"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await traiter(appel("rechercher_entreprises", {}), c());
    const t = (r?.result as { content: { text: string }[] }).content[0].text;
    expect(t).not.toMatch(/172\.26/);
    expect(t).toMatch(/Erreur interne/);
  });

  test("méthode inconnue : -32601", async () => {
    expect((await traiter({ jsonrpc: "2.0", id: 3, method: "resources/list" }, c()))?.error?.code).toBe(-32601);
  });
});
