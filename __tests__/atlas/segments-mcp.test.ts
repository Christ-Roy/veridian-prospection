/**
 * Segments Atlas par le MCP, sur une base en mémoire et la source simulée : espace imposé par
 * l'utilisateur, héritage des parents, versions et restauration, droits, erreurs lisibles.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
});
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("@/lib/prisma", () => {
  const match = (r: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "segmentId_numero") {
        const w = v as { segmentId: string; numero: number };
        return r.segmentId === w.segmentId && r.numero === w.numero;
      }
      if (v && typeof v === "object" && "in" in v) return (v as { in: unknown[] }).in.includes(r[k]);
      return v === null ? r[k] === null || r[k] === undefined : r[k] === v;
    });
  const trier = (l: Row[], orderBy?: Record<string, "asc" | "desc">) => {
    if (!orderBy) return l;
    const [k, s] = Object.entries(orderBy)[0];
    return [...l].sort((a, b) => ((a[k] as number) > (b[k] as number) ? 1 : -1) * (s === "desc" ? -1 : 1));
  };
  const modele = (nom: string) => {
    db.tables[nom] ??= [];
    const t = () => db.tables[nom];
    return {
      findFirst: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> } = {}) => trier(t().filter((r) => match(r, where)), orderBy)[0] ?? null,
      findUnique: async ({ where }: { where: Record<string, unknown> }) => t().find((r) => match(r, where)) ?? null,
      findMany: async ({ where, orderBy, take }: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take?: number } = {}) =>
        trier(t().filter((r) => match(r, where)), orderBy).slice(0, take ?? 1e9).map((r) => ({ ...r, versions: [], scorings: [] })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const { versions, ...rest } = data as { versions?: { create: Record<string, unknown> } };
        const r: Row = { id: randomUUID(), createdAt: new Date(), deletedAt: null, parentId: null, dossierId: null, ...rest };
        t().push(r);
        if (versions) db.tables.atlasSegmentVersion.push({ id: randomUUID(), createdAt: new Date(), segmentId: r.id, ...versions.create });
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(t().find((r) => r.id === where.id)!, data),
      upsert: async ({ where, create, update }: { where: { tenantId_siren: { tenantId: string; siren: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const w = where.tenantId_siren;
        const r = t().find((x) => x.tenantId === w.tenantId && x.siren === w.siren);
        if (r) return Object.assign(r, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)));
        const n: Row = { id: randomUUID(), createdAt: new Date(), ...create };
        t().push(n);
        return n;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const avant = t().length;
        db.tables[nom] = t().filter((r) => !match(r, where));
        return { count: avant - db.tables[nom].length };
      },
    };
  };
  const prisma = {
    atlasDossier: modele("atlasDossier"),
    atlasSegment: modele("atlasSegment"),
    atlasSegmentVersion: modele("atlasSegmentVersion"),
    atlasScoringVersion: modele("atlasScoringVersion"),
    atlasEpingle: modele("atlasEpingle"),
    $transaction: async (f: (tx: unknown) => unknown) => f(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/auth/user-context", () => ({}));

import { traiter } from "@/lib/mcp/protocole";
import type { UserContext } from "@/lib/auth/user-context";

const ctx = (tenantId: string, role: "member" | "viewer" = "member"): { ctx: UserContext; workspaceId: string; client: string } => ({
  ctx: { userId: "u-1", email: "a@b.fr", tenantId, tenantOwnerId: "u-1", workspaces: [{ id: "w", name: "W", slug: "w", role, visibilityScope: "all" }], isAdmin: false, activeWorkspaceId: "w" },
  workspaceId: "w",
  client: "claude",
});
let id = 0;
async function appel(c: ReturnType<typeof ctx>, name: string, args: Record<string, unknown> = {}) {
  const r = await traiter({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }, c);
  if (r?.error) return { erreur: r.error.message };
  const res = r!.result as { isError?: boolean; content: { text: string }[] };
  return res.isError ? { erreur: res.content[0].text } : JSON.parse(res.content[0].text);
}

const A = ctx("tenant-A");
const DEP69 = { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] };

beforeEach(() => {
  for (const k of Object.keys(db.tables)) db.tables[k].length = 0;
});

describe("Atlas par le MCP", () => {
  test("explorer le marché signale les données simulées", async () => {
    const r = await appel(A, "explorer_marche", { filtre: DEP69, par_page: 3 });
    expect(r.donnees_simulees).toBe(true);
    expect(r.total).toBeGreaterThan(0);
    expect(r.lignes).toHaveLength(3);
  });

  test("filtre invalide : message lisible pour que l'IA corrige", async () => {
    const r = await appel(A, "explorer_marche", { filtre: { conditions: [{ champ: "ca", op: "min", valeur: 1 }] } });
    expect(r.erreur).toMatch(/champ inconnu « ca »/);
  });

  test("dossier, segment, enfant qui hérite, versions et restauration", async () => {
    const d = await appel(A, "creer_dossier", { nom: "Analyse marché" });
    const parent = await appel(A, "creer_segment", { nom: "Rhône", filtre: DEP69, dossier_id: d.id });
    const enfant = await appel(A, "creer_segment", { nom: "Rhône avec site", filtre: { conditions: [{ champ: "site", op: "renseigne", valeur: true }] }, parent_id: parent.id });
    expect(enfant.total).toBeLessThan(parent.total);
    const lu = await appel(A, "lire_segment", { segment_id: enfant.id });
    expect(lu.filtre_effectif.conditions).toHaveLength(2);

    const v2 = await appel(A, "modifier_segment", { segment_id: parent.id, filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["38"] }] } });
    expect(v2.version).toBe(2);
    const v3 = await appel(A, "restaurer_version_segment", { segment_id: parent.id, version: 1 });
    expect(v3.version).toBe(3);
    const h = await appel(A, "historique_segment", { segment_id: parent.id });
    expect(h.filtre.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(h.filtre[0].auteur).toBe("ia:claude");
  });

  test("supprimer : un marché avec des cibles demande confirmation, puis part avec elles ; un autre espace n'y touche pas", async () => {
    const m = await appel(A, "creer_segment", { nom: "Marché à supprimer", filtre: DEP69 });
    const c1 = await appel(A, "creer_segment", { nom: "Cible 1", filtre: { conditions: [] }, parent_id: m.id });
    await appel(A, "creer_segment", { nom: "Sous-cible", filtre: { conditions: [] }, parent_id: c1.id });
    expect((await appel(ctx("tenant-B"), "supprimer_segment", { segment_id: m.id })).erreur).toMatch(/introuvable/i);
    expect((await appel(A, "supprimer_segment", { segment_id: m.id })).erreur).toMatch(/2 cibles/);
    const r = await appel(A, "supprimer_segment", { segment_id: m.id, avec_cibles: true });
    expect(r).toMatchObject({ supprime: true, cibles_supprimees: 2 });
    const noms = (await appel(A, "lister_segments_atlas")).segments.map((s: { nom: string }) => s.nom);
    expect(noms).not.toContain("Marché à supprimer");
    expect(noms).not.toContain("Sous-cible");
  });

  test("scoring : classement par score décroissant, ancienne version comparable", async () => {
    const s = await appel(A, "creer_segment", { nom: "Tout", filtre: DEP69 });
    const sc = await appel(A, "definir_scoring", { segment_id: s.id, scoring: { criteres: [{ champ: "site", op: "renseigne", valeur: true, poids: 3 }, { champ: "rge", op: "est", valeur: true, poids: 1 }] } });
    expect(sc.scoring).toBe(1);
    const c = await appel(A, "classer_segment", { segment_id: s.id, par_page: 20 });
    const scores = c.lignes.map((l: { score: number }) => l.score);
    expect(scores).toEqual([...scores].sort((x: number, y: number) => y - x));
    expect(Math.max(...scores)).toBeLessThanOrEqual(100);
  });

  test("un autre espace ne voit pas le segment : introuvable", async () => {
    const s = await appel(A, "creer_segment", { nom: "À moi", filtre: DEP69 });
    const B = ctx("tenant-B");
    expect((await appel(B, "lire_segment", { segment_id: s.id })).erreur).toMatch(/introuvable/);
    expect((await appel(B, "modifier_segment", { segment_id: s.id, nom: "volé" })).erreur).toMatch(/introuvable/);
    expect((await appel(B, "lister_segments_atlas")).segments).toEqual([]);
  });

  test("sans la vraie source ODH ni ATLAS_SIMULE, aucun outil Atlas n'est exposé", async () => {
    process.env.ATLAS_SIMULE = "";
    try {
      const r = await traiter({ jsonrpc: "2.0", id: 999, method: "tools/list" }, A);
      const noms = (r!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
      expect(noms).not.toContain("explorer_marche");
      expect(noms).toEqual([]);
    } finally {
      process.env.ATLAS_SIMULE = "1";
    }
  });

  test("fiche d'une entreprise, points d'un département, SIREN invalide refusé", async () => {
    const pts = await appel(A, "points_carte", { filtre: {}, departement: "69", limite: 5 });
    expect(pts.points).toHaveLength(5);
    expect(pts.points[0]).toMatchObject({ siren: expect.any(String), lat: expect.any(Number), lon: expect.any(Number) });
    const f = await appel(A, "fiche_entreprise_atlas", { siren: pts.points[0].siren });
    expect(f.fiche.identite.siren).toBe(pts.points[0].siren);
    expect((await appel(A, "fiche_entreprise_atlas", { siren: "12" })).erreur).toMatch(/SIREN/);
    expect((await appel(A, "fiche_entreprise_atlas", { siren: "123456789" })).erreur).toMatch(/Aucune entreprise/);
  });

  test("dossier de travail : épingler, idempotent, lister, retirer ; invisible depuis un autre espace", async () => {
    expect((await appel(A, "epingler", { siren: "900000001", nom: "Élevage test", note: "à rappeler" })).epingle).toBe(true);
    await appel(A, "epingler", { siren: "900000001", nom: "Élevage test" });
    const l = await appel(A, "lister_epingles");
    expect(l.epingles).toHaveLength(1);
    expect(l.epingles[0]).toMatchObject({ siren: "900000001", note: "à rappeler", auteur: "ia:claude" });
    expect((await appel(ctx("tenant-B"), "lister_epingles")).epingles).toEqual([]);
    expect((await appel(ctx("tenant-B"), "retirer_epingle", { siren: "900000001" })).erreur).toMatch(/aucune épingle/);
    expect((await appel(A, "retirer_epingle", { siren: "900000001" })).epingle).toBe(false);
  });

  test("un lecteur explore mais ne crée rien", async () => {
    const V = ctx("tenant-A", "viewer");
    expect((await appel(V, "explorer_marche", { filtre: DEP69 })).total).toBeGreaterThan(0);
    expect((await appel(V, "creer_segment", { nom: "x", filtre: DEP69 })).erreur).toMatch(/outil inconnu/);
  });
});
