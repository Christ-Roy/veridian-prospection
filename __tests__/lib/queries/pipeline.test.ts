/**
 * Tests focalisés sur la validation UUID userFilter de getPipelineLeads,
 * ajoutée suite au refactor visibility cross-membre (2026-05-19).
 *
 * 2026-05-20 : ajout d'invariants pour patchOutreach() + updateOutreach()
 * sur le sync status ↔ pipeline_stage. Mise à jour : suppression de l'import
 * applyStatusTransition (non utilisé dans pipeline.ts, helper appelé
 * indirectement via pipelineStageForStatus uniquement).
 *
 * Périmètre : uniquement les changements liés à la PR. Le reste de
 * getPipelineLeads (group by stage, calcul email_count, etc.) reste en
 * tests-pending.txt.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { pipelineStageForStatus, applyStatusTransition } from "@/lib/outreach/status";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

import { getPipelineLeads } from "@/lib/queries/pipeline";
import { prisma } from "@/lib/prisma";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";

describe("getPipelineLeads — visibility refactor 2026-05-19", () => {
  beforeEach(() => vi.clearAllMocks());

  test("accepte userFilter UUID valide", async () => {
    await expect(getPipelineLeads(T, null, U)).resolves.toBeDefined();
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain(`o.user_id = '${U}'`);
  });

  test("accepte userFilter null (admin / team-view)", async () => {
    await expect(getPipelineLeads(T, null, null)).resolves.toBeDefined();
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).not.toMatch(/AND o\.user_id\s*=/);
  });

  test("rejette userFilter non-UUID (anti SQL injection)", async () => {
    await expect(getPipelineLeads(T, null, "'; DROP TABLE outreach;--"))
      .rejects.toThrow(/invalid userFilter/);
  });

  test("rejette userFilter avec wildcard SQL", async () => {
    await expect(getPipelineLeads(T, null, "%' OR 1=1 --"))
      .rejects.toThrow(/invalid userFilter/);
  });
});

describe("patchOutreach/updateOutreach — sync status ↔ pipeline_stage (2026-05-20)", () => {
  test("status='hors_cible' (dismiss UI) → pipeline_stage='hors_cible' (terminal)", () => {
    expect(pipelineStageForStatus("hors_cible")).toBe("hors_cible");
  });

  test("status='contacte' (mail send) → pipeline_stage='repondeur'", () => {
    expect(pipelineStageForStatus("contacte")).toBe("repondeur");
  });

  test("anti-régression : 'appele' sur lead en 'acompte' → null (preserve)", () => {
    expect(applyStatusTransition("appele", "acompte", "acompte")).toBeNull();
  });

  test("terminal hors_cible force même depuis lead avancé", () => {
    // Commercial peut toujours archiver un lead, même en cours de contrat.
    expect(applyStatusTransition("hors_cible", "site_demo", "site_demo")).toEqual({
      status: "hors_cible",
      pipeline_stage: "hors_cible",
    });
  });
});

// Anti-régression : champ email_count retiré du PipelineLead (cleanup
// envoi email himalaya 2026-05-20). La sous-query SQL COUNT(*) FROM
// outreach_emails et le mapping email_count ne doivent pas réapparaître.
describe("queries/pipeline source — anti-régression Claude+email cleanup", () => {
  test("le source n'inclut plus la sous-query outreach_emails ni le champ email_count", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/queries/pipeline.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/outreach_emails/);
    expect(source).not.toMatch(/email_count/);
    expect(source).not.toMatch(/twOe\b/);
  });
});

/**
 * Anti-régression grouping élargi (ticket 2026-05-23 pipeline-stages-
 * customisables) — le grouping côté getPipelineLeads acceptait avant
 * uniquement les 9 slugs canoniques hardcodés (NEW_STAGES). Avec les
 * stages custom par workspace, on doit accepter n'importe quel slug
 * non-vide écrit dans outreach.pipeline_stage sinon les leads sur stage
 * custom disparaissent du kanban.
 */
/**
 * Hook `recordPipelineTransition` (fiche historique 360° Phase 1, 2026-05-24)
 * — exposé via __pipelineTestingInternals. Tests de comportement, pas source-
 * level : on injecte un mock `model` (pas le vrai Prisma) et on vérifie que
 *
 *  1. no-op si fromStage === toStage (évite spam timeline)
 *  2. INSERT correct si stage différent
 *  3. best-effort : un échec du create est avalé (la mutation outreach
 *     parente NE DOIT PAS échouer à cause du logging)
 *
 * Sabotage à reconnaître : retirer le early-return → on log même quand le
 * stage n'a pas bougé → spam timeline + bug visible. Ce test casserait.
 */
describe("recordPipelineTransition hook — fiche historique 360°", () => {
  test("no-op si fromStage === toStage (early return)", async () => {
    const { __pipelineTestingInternals } = await import("@/lib/queries/pipeline");
    const createSpy = vi.fn();
    await __pipelineTestingInternals.recordPipelineTransition(
      {
        siren: "123456789",
        tenantId: "tenant-test-1",
        workspaceId: "ws-1",
        userId: "user-1",
        fromStage: "site_demo",
        toStage: "site_demo",
      },
      { create: createSpy },
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("INSERT correct quand stage change", async () => {
    const { __pipelineTestingInternals } = await import("@/lib/queries/pipeline");
    const createSpy = vi.fn().mockResolvedValue({});
    await __pipelineTestingInternals.recordPipelineTransition(
      {
        siren: "123456789",
        tenantId: "tenant-test-1",
        workspaceId: "ws-1",
        userId: "user-1",
        fromStage: "a_rappeler",
        toStage: "site_demo",
      },
      { create: createSpy },
    );
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      data: {
        siren: "123456789",
        tenantId: "tenant-test-1",
        workspaceId: "ws-1",
        userId: "user-1",
        fromStage: "a_rappeler",
        toStage: "site_demo",
      },
    });
  });

  test("INSERT aussi quand fromStage null (premier contact) → toStage", async () => {
    const { __pipelineTestingInternals } = await import("@/lib/queries/pipeline");
    const createSpy = vi.fn().mockResolvedValue({});
    await __pipelineTestingInternals.recordPipelineTransition(
      {
        siren: "987654321",
        tenantId: "tenant-test-1",
        workspaceId: null,
        userId: null,
        fromStage: null,
        toStage: "fiche_ouverte",
      },
      { create: createSpy },
    );
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStage: null,
        toStage: "fiche_ouverte",
        workspaceId: null,
        userId: null,
      }),
    });
  });

  test("best-effort : erreur create avalée sans rejeter (résistance prod)", async () => {
    const { __pipelineTestingInternals } = await import("@/lib/queries/pipeline");
    const createSpy = vi.fn().mockRejectedValue(new Error("DB down"));
    // L'invariant CRITIQUE : si le logging timeline plante, la mutation
    // outreach parente DOIT continuer. On ne fait pas échouer un drag-drop
    // kanban à cause d'une indispo timeline.
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      __pipelineTestingInternals.recordPipelineTransition(
        {
          siren: "111111111",
          tenantId: "tenant-test-1",
          workspaceId: null,
          userId: null,
          fromStage: "fiche_ouverte",
          toStage: "repondeur",
        },
        { create: createSpy },
      ),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

/**
 * Anti-régression source-level : les 4 sites de mutation pipeline_stage
 * doivent câbler le hook. Si quelqu'un retire un appel, la timeline rate
 * silencieusement la transition de ce point d'entrée.
 */
describe("pipeline.ts source — hook recordPipelineTransition câblé partout", () => {
  test("hook appelé dans updateOutreach + patchOutreach + reorder + batchReorder", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/queries/pipeline.ts"),
      "utf-8",
    );
    // 4 appels minimum (un par site de mutation). On compte avec
    // (match ?? []).length pour résister à l'évolution du code.
    const calls = source.match(/recordPipelineTransition\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  test("export __pipelineTestingInternals exposé (sinon les tests cassent)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/queries/pipeline.ts"),
      "utf-8",
    );
    expect(source).toMatch(/export\s+const\s+__pipelineTestingInternals\s*=\s*\{\s*recordPipelineTransition\s*\}/);
  });
});

describe("pipeline.ts — grouping accepte slugs custom (2026-05-23)", () => {
  test("ne contient plus la liste hardcodée NEW_STAGES côté grouping", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/queries/pipeline.ts"),
      "utf-8",
    );
    // Avant : `const NEW_STAGES = ["fiche_ouverte", "repondeur", ...]` puis
    // `NEW_STAGES.includes(ps)`. Après : trim + comparaison à a_contacter
    // seulement (toute autre valeur non vide est un stage valide).
    expect(source).not.toMatch(/const\s+NEW_STAGES\s*=\s*\[/);
    expect(source).not.toMatch(/NEW_STAGES\.includes\(/);
  });

  test("utilise un grouping élargi (trim + check a_contacter)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/queries/pipeline.ts"),
      "utf-8",
    );
    // Pattern caractéristique de l'élargissement : on regarde si ps est
    // non-vide et différent de "a_contacter", sinon fallback status.
    expect(source).toMatch(/ps\s*&&\s*ps\s*!==\s*["']a_contacter["']/);
  });
});
