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
    tenant: modele("tenant"),
    $transaction: async (f: (tx: unknown) => unknown) => f(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/auth/user-context", () => ({}));

import { traiter } from "@/lib/mcp/protocole";
import { retirerCoordonnees } from "@/lib/mcp/coordonnees";
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";
import { sourceMarche } from "@/atlas/source";
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

  test("dossiers : ranger un marché, renommer, supprimer sans jamais perdre de marché ; une cible suit son marché", async () => {
    const d1 = await appel(A, "creer_dossier", { nom: "D1" });
    const d2 = await appel(A, "creer_dossier", { nom: "D2" });
    const m = await appel(A, "creer_segment", { nom: "Marché rangé", filtre: DEP69, dossier_id: d1.id });
    const cible = await appel(A, "creer_segment", { nom: "Cible", filtre: { conditions: [] }, parent_id: m.id });
    await appel(A, "modifier_segment", { segment_id: m.id, dossier_id: d2.id });
    const arbre = () => appel(A, "lister_segments_atlas");
    expect((await arbre()).segments.find((s: { id: string }) => s.id === m.id).dossier_id).toBe(d2.id);
    expect((await appel(A, "modifier_segment", { segment_id: cible.id, dossier_id: d1.id })).erreur).toMatch(/suit son marché/);
    expect((await appel(A, "renommer_dossier", { dossier_id: d2.id, nom: "Clients" })).nom).toBe("Clients");
    const r = await appel(A, "supprimer_dossier", { dossier_id: d2.id });
    expect(r).toMatchObject({ supprime: true, marches_remontes: 1 });
    const apres = await arbre();
    expect(apres.dossiers.map((d: { nom: string }) => d.nom)).not.toContain("Clients");
    expect(apres.segments.find((s: { id: string }) => s.id === m.id)).toMatchObject({ dossier_id: null });
    expect((await appel(ctx("tenant-B"), "supprimer_dossier", { dossier_id: d1.id })).erreur).toMatch(/introuvable/i);
  });

  test("préparer un export : des liens à cliquer, jamais les données ; refusé hors plan payant", async () => {
    const s = await appel(A, "creer_segment", { nom: "À exporter", filtre: DEP69 });
    const r = await appel(A, "preparer_export", { segment_id: s.id });
    expect(r.autorise).toBe(false);
    expect(r.excel).toBeUndefined();
    expect(r.message).toMatch(/plans payants/);
    expect(JSON.stringify(r)).not.toMatch(/@|siren/i);
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

  test("tools/list sert la mention « à nommer dans autoriser » sur les outils d'écriture seulement", async () => {
    const r = await traiter({ jsonrpc: "2.0", id: 998, method: "tools/list" }, A);
    const servis = new Map((r!.result as { tools: { name: string; description: string }[] }).tools.map((t) => [t.name, t.description]));
    expect(servis.get("creer_segment")).toContain("à nommer dans autoriser");
    expect(servis.get("extraire_segment")).toContain("à nommer dans autoriser");
    expect(servis.get("explorer_marche")).not.toContain("autoriser");
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

  test("marché par commune : contours rapprochés, et sans l'API Géo la liste reste servie", async () => {
    const vrai = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => new Response("indisponible", { status: 503 })) as typeof fetch;
      const sans = await appel(A, "repartir_communes", { filtre: {}, departement: "38", base: "prospection" });
      expect(sans.communes[0]).toMatchObject({ code: "69381", nom: "Commune simulée" });
      expect(sans.communes[0].mesures.entreprises).toBeGreaterThan(0);
      const geo = { features: [{ properties: { code: "69381", nom: "Commune simulée" }, geometry: { type: "Polygon", coordinates: [[[5, 45], [5.1, 45], [5.1, 45.1], [5, 45]]] } }] };
      globalThis.fetch = vi.fn(async () => Response.json(geo)) as typeof fetch;
      const avec = await appel(A, "repartir_communes", { filtre: {}, departement: "69", base: "marche" });
      expect(avec).toMatchObject({ base: "marche", repli: false, departement: "69" });
      expect(avec.communes).toHaveLength(1);
      expect(avec.non_rapprochees).toEqual({});
      expect(avec.intercommunalites).toEqual([]); // commune simulée hors EPCI
      expect((await appel(A, "repartir_communes", { filtre: {}, departement: "6" })).erreur).toBeTruthy();
    } finally {
      globalThis.fetch = vrai;
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
    // Sans nom, il est retrouvé par le SIREN (l'IA n'a pas à le recopier) ; SIREN inconnu : message lisible.
    expect((await appel(A, "epingler", { siren: "900000002" })).epingle).toBe(true);
    expect((await appel(A, "lister_epingles")).epingles.find((e: { siren: string }) => e.siren === "900000002")?.nom).toBe("Entreprise simulée 2");
    expect((await appel(A, "epingler", { siren: "999999999" })).erreur).toMatch(/Aucune entreprise/);
    await appel(A, "retirer_epingle", { siren: "900000002" });
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

/** Coordonnées et programmes (24/11) : hors extraire_segment, aucun outil n'en rend à un appel de programme. */
describe("appel d'un programme : aucune coordonnée hors extraire_segment", () => {
  const droitsDe = (plan: "gratuit" | "payant" | "avance" | "absents") =>
    plan === "absents" ? {} : { droits: { accesAvance: plan === "avance", adminAtlas: false, plan: plan === "gratuit" ? "freemium" : "pro", payant: plan !== "gratuit" } };
  type Plan = Parameters<typeof droitsDe>[0];
  async function prog(plan: Plan, name: string, args: Record<string, unknown> = {}, programme = true) {
    const r = await traiter({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }, { ...A, ...droitsDe(plan) }, undefined, programme);
    if (r?.error) throw new Error(r.error.message);
    const x = r!.result as { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
    return { erreur: x.isError ? x.content[0].text : null, v: x.structuredContent ?? null, brut: JSON.stringify(x) };
  }
  const COORDONNEE = /@entreprise-|0400000000/;
  const TOUT = { conditions: [{ champ: "email", op: "renseigne", valeur: true }] };
  const COLONNES = ["nom", "email", "telephone", "site"];
  async function preparer() {
    const s = await appel(A, "creer_segment", { nom: "Avec coordonnées", filtre: TOUT, colonnes: COLONNES });
    const [l] = (await sourceMarche().apercu(TOUT, { colonnes: ["email"], page: 1, parPage: 1 })).lignes;
    return { segment_id: s.id as string, siren: String(l.siren) };
  }

  test("chaque outil, gratuit, payant ou droits illisibles : ni email ni téléphone ; le même appel direct en rend", async () => {
    const { segment_id, siren } = await preparer();
    const ap: Record<string, Record<string, unknown>> = {
      lister_champs: {}, explorer_marche: { filtre: TOUT, par_page: 50 }, repartir_marche: { filtre: TOUT, champ: "departement" },
      analyser_marche: { filtre: DEP69 }, lister_entreprises: { filtre: DEP69 }, chercher_activites: { mots: "conseil" },
      fiche_entreprise_atlas: { siren }, points_carte: { filtre: DEP69, departement: "69" }, lister_epingles: {}, epingler: { siren },
      repartir_communes: { filtre: DEP69, departement: "69", base: "prospection" }, lister_segments_atlas: {}, lire_segment: { segment_id },
      creer_segment: { nom: "x", filtre: TOUT, colonnes: COLONNES }, modifier_segment: { segment_id, colonnes: COLONNES },
      definir_scoring: { segment_id, scoring: { criteres: [{ champ: "site", op: "renseigne", valeur: true, poids: 1 }] } },
      classer_segment: { segment_id, par_page: 50 }, historique_segment: { segment_id }, restaurer_version_segment: { segment_id, version: 1 },
      creer_dossier: { nom: "d" }, retirer_epingle: { siren }, preparer_export: { segment_id },
    };
    // Ne lisent aucune fiche, ou réservés à l'accès avancé ou à l'administration, ou seul outil qui rend des coordonnées.
    const hors = new Set(["creer_rapport", "tournee_maps", "importer_clients", "retirer_clients", "penetration_marche", "clients_resume", "extraire_segment", "schema_odh", "requete_sql", "lister_cles_api", "creer_cle_api", "revoquer_cle_api", "accorder_acces_avance", "lister_acces_avances", "connexions_ia", "mes_droits", "verifier_entreprises", "renommer_dossier", "supprimer_dossier", "supprimer_segment"]);
    // Un outil ajouté demain doit choisir son camp ici.
    expect(OUTILS_ATLAS.map((o) => o.name).filter((n) => !ap[n] && !hors.has(n))).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("hors ligne"); }));
    for (const plan of ["gratuit", "payant", "absents"] as Plan[]) {
      for (const [nom, args] of Object.entries(ap)) {
        const r = await prog(plan, nom, args);
        expect(r.erreur, `${plan} ${nom}`).toBeNull();
        expect(r.brut, `${plan} ${nom}`).not.toMatch(COORDONNEE);
      }
      expect((await prog(plan, "classer_segment", ap.classer_segment)).v?.coordonnees_retirees).toMatch(/extraire_segment/);
    }
    vi.unstubAllGlobals();
    // Témoin : sans le mode programme, rien ne change (VER-249 attend Robert), et l'accès avancé n'est pas restreint.
    for (const nom of ["classer_segment", "fiche_entreprise_atlas", "definir_scoring"]) {
      expect((await prog("gratuit", nom, ap[nom], false)).brut, nom).toMatch(COORDONNEE);
      expect((await prog("avance", nom, ap[nom])).brut, nom).toMatch(COORDONNEE);
    }
    expect((await prog("gratuit", "explorer_marche", { filtre: TOUT, colonnes: COLONNES }, false)).brut).toMatch(COORDONNEE);

    // VER-249, éteint par défaut : allumé, un compte gratuit n'en lit plus par aucun outil, en appel direct ; les autres ne bougent pas.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("hors ligne"); }));
    for (const valeur of ["masque", "fiches:0"]) {
      vi.stubEnv("ATLAS_GRATUIT_COORDONNEES", valeur);
      for (const plan of ["gratuit", "absents"] as Plan[]) {
        for (const [nom, args] of Object.entries(ap)) {
          const r = await prog(plan, nom, args, false);
          expect(r.erreur, `${valeur} ${plan} ${nom}`).toBeNull();
          expect(r.brut, `${valeur} ${plan} ${nom}`).not.toMatch(COORDONNEE);
        }
        const fiche = await prog(plan, "fiche_entreprise_atlas", { siren }, false);
        expect(fiche.brut).toContain("réservés aux plans payants");
        expect(fiche.brut).toContain("identite");
        expect((await prog(plan, "explorer_marche", { filtre: { conditions: [{ champ: "email", op: "contient", valeur: "contact@" }] } }, false)).erreur).toMatch(/plans payants/);
      }
      for (const plan of ["payant", "avance"] as Plan[]) for (const nom of ["classer_segment", "fiche_entreprise_atlas"]) expect((await prog(plan, nom, ap[nom], false)).brut, `${valeur} ${plan}`).toMatch(COORDONNEE);
    }
    for (const illisible of ["", "oui", "fiches:", "masque,fiches:2"]) {
      vi.stubEnv("ATLAS_GRATUIT_COORDONNEES", illisible);
      expect((await prog("gratuit", "fiche_entreprise_atlas", { siren }, false)).brut, illisible).toMatch(COORDONNEE);
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("demander la colonne est refusé avec une orientation ; hors programme, accepté", async () => {
    for (const colonnes of [["email"], ["nom", "telephone"]]) {
      const r = await prog("payant", "explorer_marche", { filtre: TOUT, colonnes });
      expect(r.erreur).toMatch(/Colonne refusée ici : (email|telephone)\. .*extraire_segment/);
    }
    expect((await prog("avance", "explorer_marche", { filtre: TOUT, colonnes: ["email"] })).erreur).toBeNull();
    expect((await prog("gratuit", "explorer_marche", { filtre: TOUT, colonnes: ["email"] }, false)).erreur).toBeNull();
  });

  test("deviner par le filtre est refusé : filtre direct, segment déjà enregistré, scoring", async () => {
    const DEVINE = { conditions: [{ champ: "email", op: "contient", valeur: "contact@" }] };
    const s = await appel(A, "creer_segment", { nom: "Contact", filtre: DEVINE });
    const { segment_id } = await preparer();
    const essais: [string, Record<string, unknown>][] = [
      ["explorer_marche", { filtre: DEVINE }],
      ["repartir_marche", { filtre: DEVINE, champ: "departement" }],
      ["points_carte", { filtre: DEVINE, departement: "69" }],
      ["explorer_marche", { filtre: { conditions: [{ champ: "telephone", op: "egal", valeur: "0400000000" }] } }],
      ["classer_segment", { segment_id: s.id }],
      ["lire_segment", { segment_id: s.id }],
      ["definir_scoring", { segment_id, scoring: { criteres: [{ champ: "email", op: "contient", valeur: "a@", poids: 1 }] } }],
    ];
    for (const [nom, args] of essais) {
      expect((await prog("payant", nom, args)).erreur, nom).toMatch(/ne se filtre ici que par « renseigne »/);
      expect((await prog("payant", nom, args, false)).erreur, `${nom} direct`).toBeNull();
    }
  });

  test("le retrait lit les valeurs, pas seulement les clés, et garde drapeaux, comptes, SIREN et écrits de l'utilisateur", () => {
    const garde = {
      siren: "005520135", siret: "00552013500012", n: "0475.5", lat: "45.0475123456", email: true, email_envoyable: 12, motif_email: "boite_inexistante", date: "2024-01-05", naf: "7500Z", iso: "2026-11-24T18:17:00.000Z",
      id: "0a1b2c3d-0123-4567-8901-012345678901", note: "appeler a@b.fr", filtre: { valeur: "a@b.fr" }, colonnes: ["email", "telephone"],
    };
    expect(retirerCoordonnees(garde)).toEqual(garde);
    const r = JSON.stringify(retirerCoordonnees({
      autre: "Jean <jean.dupont@exemple.fr>", liste: ["04 00 00 00 00", "+33 (0)4 00 00 00 00", "+41223334455", "04.00.00.00.00", "écrire à é.a@b.co.uk"], contact: { telephone: "poste 12", Email: ["x"] }, t: [[{ phone: "1" }]],
    }));
    expect(r).not.toMatch(/@|00 00|00\.00|4122|poste|"x"|"1"/);
    expect(r).toContain("extraire_segment");
  });

  test("un texte énorme ne bloque pas le processeur", () => {
    for (const t of ["a".repeat(1_000_000), "@" + "a".repeat(1_000_000), "0 ".repeat(500_000), "+1".repeat(500_000), "a@".repeat(500_000), "a.".repeat(500_000) + "@"]) {
      const t0 = performance.now();
      retirerCoordonnees({ t });
      expect(performance.now() - t0).toBeLessThan(2_000);
    }
  }, 60_000);
});
