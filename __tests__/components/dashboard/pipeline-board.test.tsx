/**
 * Tests source-level sur src/components/dashboard/pipeline-board.tsx.
 *
 * Anti-régression du cleanup Claude+email himalaya legacy 2026-05-20.
 *
 * Avant cleanup, le fichier contenait une modale EmailComposeModal qui
 * appelait /api/outreach/[domain]/send (himalaya CLI cassé en prod) +
 * un state setEmailModal jamais déclenché côté UI (composant mort). Le
 * cleanup a supprimé les deux.
 */
import { describe, expect, test } from "vitest";

describe("pipeline-board.tsx — anti-régression Claude+email cleanup 2026-05-20", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("plus de fonction EmailComposeModal", () => {
    expect(source).not.toMatch(/function\s+EmailComposeModal/);
  });

  test("plus de state emailModal / setEmailModal", () => {
    expect(source).not.toMatch(/emailModal/);
    expect(source).not.toMatch(/setEmailModal/);
  });

  test("plus de fetch /api/outreach/.../send", () => {
    expect(source).not.toMatch(/\/api\/outreach\/[^"`']*\/send/);
  });

  test("plus de champ email_count dans le type PipelineLead", () => {
    // Le type local PipelineLead ne doit plus contenir email_count puisque
    // l'API ne le renvoie plus (cleanup pipeline.ts).
    expect(source).not.toMatch(/email_count/);
  });

  test("conserve les imports React/Button toujours utilisés (sanity)", () => {
    expect(source).toMatch(/from\s+"@\/components\/ui\/button"/);
    expect(source).toMatch(/from\s+"@\/components\/ui\/badge"/);
  });
});

describe("pipeline-board.tsx — responsive mobile (sprint UI 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Fix #2 — sur mobile, le board Kanban horizontal est remplacé par un
  // accordéon vertical (8 stades empilés). Régression si le rendu mobile
  // disparaît.
  test("rend une vue accordéon mobile via le composant Accordion", () => {
    expect(source).toMatch(/from\s+"@\/components\/ui\/accordion"/);
  });

  test("dédouble le rendu board horizontal / accordéon par breakpoint md", () => {
    // Le board horizontal est masqué sous md, l'accordéon masqué à partir de md.
    expect(source).toMatch(/md:hidden|hidden md:/);
  });

  // Fix #2 — toutes les tailles de police arbitraires < 12px ont été
  // remplacées par text-xs (12px, minimum lisible du design system).
  test("aucune taille de police arbitraire sous 12px", () => {
    expect(source).not.toMatch(/text-\[(9|10|11)px\]/);
  });
});

describe("pipeline-board.tsx — code-split LeadSheet (perf sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // LeadSheet pèse ~2885 lignes (sous-sections incluses) — l'inclure dans
  // le bundle initial de /pipeline le faisait grossir de plusieurs centaines
  // de Ko. Le sort en next/dynamic + ssr:false l'isole en chunk lazy chargé
  // au premier clic. Régression si on re-importe LeadSheet en statique.
  test("LeadSheet est importé via next/dynamic (pas en import statique)", () => {
    expect(source).toMatch(/import\s+dynamic\s+from\s+"next\/dynamic"/);
    expect(source).toMatch(
      /const\s+LeadSheet\s*=\s*dynamic\s*\(\s*\(\)\s*=>\s*import\s*\(\s*"\.\/lead-sheet"\s*\)/,
    );
  });

  test("aucun import statique de ./lead-sheet (sinon le code-split casse)", () => {
    // Le pattern à éviter : `import { LeadSheet } from "./lead-sheet"`
    // qui ramène tout le module dans le bundle initial.
    expect(source).not.toMatch(/^import\s+\{[^}]*LeadSheet[^}]*\}\s+from\s+"\.\/lead-sheet"/m);
  });

  test("LeadSheet monté en `ssr: false` (chunk client-only)", () => {
    expect(source).toMatch(/ssr:\s*false/);
  });

  // Conserve l'animation de fermeture du <Sheet> Radix en gardant le
  // composant monté après la première ouverture.
  test("conserve l'animation de fermeture via state `leadSheetOpened`", () => {
    expect(source).toMatch(/leadSheetOpened/);
    expect(source).toMatch(/setLeadSheetOpened/);
  });
});

describe("pipeline-board.tsx — guard défensif fetchPipeline (bug intermittent 2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Bug intermittent : si /api/pipeline renvoie un shape inattendu (auth
  // expirée, erreur sérialisée, redirect), `data.pipeline` peut être
  // undefined. Sans guard, le prochain Object.values(pipeline).flat()
  // au render throw "Cannot read properties of undefined". Le setter
  // doit retomber sur {} si shape invalide.
  test("setPipeline gardé contre data.pipeline undefined / non-objet", () => {
    expect(source).not.toMatch(/setPipeline\(data\.pipeline\)\s*;/);
    expect(source).toMatch(
      /setPipeline\(\s*data\?\.pipeline\s*&&\s*typeof\s+data\.pipeline\s*===\s*"object"/,
    );
  });

  // Sabotage-check : si on retire le guard pour revenir à
  // `setPipeline(data.pipeline)`, ce test rougit immédiatement.
  test("aucun setPipeline non-gardé sur data.pipeline", () => {
    // Match strict du pattern dangereux (sans le guard).
    expect(source).not.toMatch(/setPipeline\(\s*data\.pipeline\s*\)/);
  });
});

describe("sans-site-sidebar.tsx — guard data.qualiopiSpecialites (bug intermittent 2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/sans-site-sidebar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Si l'API /api/sans-site-filters renvoie data sans qualiopiSpecialites
  // (rétrocompat, fail partiel), `data.qualiopiSpecialites.length` throw.
  test("accès qualiopiSpecialites.length gardé par ?. / ?? 0", () => {
    expect(source).not.toMatch(/data\.qualiopiSpecialites\.length/);
    expect(source).toMatch(/qualiopiSpecialites\?\.length/);
  });
});

describe("pipeline-board.tsx — stages dynamiques par workspace (2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Migration vers stages custom par workspace (ticket pipeline-stages-
  // customisables) : le kanban lit les stages via le hook au lieu de la
  // constante hardcodée. Casser ce contrat = un workspace avec stages
  // custom n'affiche que les 8 par défaut (régression silencieuse).
  test("importe useWorkspacePipelineStages depuis le hook partagé", () => {
    expect(source).toMatch(/from\s+"@\/hooks\/use-pipeline-stages"/);
    expect(source).toContain("useWorkspacePipelineStages");
  });

  test("n'importe plus PIPELINE_STAGES depuis @/lib/types (sabotage : importer = rouge)", () => {
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bPIPELINE_STAGES\b[^}]*\}\s*from\s*["']@\/lib\/types["']/,
    );
  });

  test("itère sur visibleStages (issu du hook) pour les colonnes du board", () => {
    expect(source).toContain("visibleStages.map");
  });

  test("filtre les stages isHidden du board principal (visibleStages)", () => {
    expect(source).toMatch(/visibleStages\s*=\s*workspaceStages\.filter\(\s*\(s\)\s*=>\s*!s\.isHidden\s*\)/);
  });
});

describe("segment-page.tsx — guard setSegments Array.isArray (bug intermittent 2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/segment-page.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // JSON.parse(text) peut retourner n'importe quel type — sans
  // Array.isArray on peut stocker un objet dans `segments: SegmentInfo[]`
  // et tout `segments.find()` / `.filter()` ultérieur throw.
  test("setSegments gardé par Array.isArray fallback []", () => {
    expect(source).toMatch(/setSegments\(\s*Array\.isArray\(d\)\s*\?\s*d\s*:\s*\[\]\s*\)/);
  });
});
