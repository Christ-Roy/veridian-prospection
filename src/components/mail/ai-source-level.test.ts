/**
 * Source-level tests — vérifient à la lecture du fichier source que :
 *  - le bouton "✨ Rédige avec IA" est présent dans compose-mail-dialog.tsx
 *  - l'onglet IA est dans la page /settings/mail
 *  - le sous-modal AiGenerateDialog référence l'endpoint /api/mail/generate
 *  - le composant AiConfigForm est admin only (requireAdmin via API)
 *
 * Pourquoi pas un test render React : Husky pre-push fait `npm run build`
 * qui couvre déjà la compilation TS+React. Le source-level test attrape
 * les régressions volontaires/accidentelles d'UI sans tooling jsdom.
 *
 * Sabotage-test : si quelqu'un retire le bouton "Rédige avec IA" → ce test
 * rougit. Si quelqu'un retire l'onglet IA → ce test rougit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("compose-mail-dialog — bouton Rédige avec IA", () => {
  const src = read("src/components/mail/compose-mail-dialog.tsx");

  it("contient le libellé 'Rédige avec IA'", () => {
    expect(src).toContain("Rédige avec IA");
  });

  it("importe AiGenerateDialog", () => {
    expect(src).toMatch(/from\s+["']@\/components\/mail\/ai-generate-dialog["']/);
  });

  it("rend <AiGenerateDialog> conditionnellement (siren-gated)", () => {
    expect(src).toMatch(/siren\s*&&\s*\(\s*<AiGenerateDialog/);
  });

  it("expose data-testid='ai-generate-trigger' pour les E2E", () => {
    expect(src).toContain('data-testid="ai-generate-trigger"');
  });
});

describe("ai-generate-dialog — POST /api/mail/generate", () => {
  const src = read("src/components/mail/ai-generate-dialog.tsx");

  it("fetch /api/mail/generate avec method POST", () => {
    expect(src).toContain('"/api/mail/generate"');
    expect(src).toMatch(/method:\s*["']POST["']/);
  });

  it("envoie siren + objective + tone", () => {
    expect(src).toContain("siren");
    expect(src).toContain("objective");
    expect(src).toContain("tone");
  });

  it("gère le cas 412 not_configured (UX explicite)", () => {
    expect(src).toContain("412");
  });

  it("data-testid='ai-generate-submit' pour les E2E", () => {
    expect(src).toContain('data-testid="ai-generate-submit"');
  });
});

describe("settings/mail/page — double onglet SMTP + IA", () => {
  const src = read("src/app/settings/mail/page.tsx");

  it("importe Tabs + AiConfigForm", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/tabs["']/);
    expect(src).toContain("AiConfigForm");
  });

  it("contient un onglet 'IA' (TabsTrigger value='ia')", () => {
    expect(src).toMatch(/TabsTrigger\s+value=["']ia["']/);
  });

  it("contient un onglet 'SMTP' (TabsTrigger value='smtp')", () => {
    expect(src).toMatch(/TabsTrigger\s+value=["']smtp["']/);
  });
});

describe("ai-config-form — admin only + UI complète", () => {
  const src = read("src/components/mail/ai-config-form.tsx");

  it("gère le cas 403 (forbidden = pas admin)", () => {
    expect(src).toContain("403");
    expect(src).toContain("forbidden");
  });

  it("input password pour la clé API (jamais en clair dans le DOM)", () => {
    expect(src).toMatch(/type=["']password["']/);
  });

  it("dropdown provider liste les 4 options", () => {
    expect(src).toContain("AI_PROVIDERS");
  });

  it("bouton 'Tester' présent", () => {
    expect(src).toContain("Tester");
  });

  it("bouton 'Supprimer' (DELETE config) présent", () => {
    expect(src).toContain("Supprimer");
  });
});

describe("API routes — endpoints exposés", () => {
  it("/api/mail/generate existe avec POST + requireAuth", () => {
    const src = read("src/app/api/mail/generate/route.ts");
    expect(src).toMatch(/export\s+async\s+function\s+POST/);
    expect(src).toContain("requireAuth");
    expect(src).toContain("isRateLimited");
  });

  it("/api/mail/ai-config GET + PUT + DELETE", () => {
    const src = read("src/app/api/mail/ai-config/route.ts");
    expect(src).toMatch(/export\s+async\s+function\s+GET/);
    expect(src).toMatch(/export\s+async\s+function\s+PUT/);
    expect(src).toMatch(/export\s+async\s+function\s+DELETE/);
    expect(src).toContain("requireAdmin");
  });

  it("/api/mail/ai-config/test endpoint", () => {
    const src = read("src/app/api/mail/ai-config/test/route.ts");
    expect(src).toMatch(/export\s+async\s+function\s+POST/);
    expect(src).toContain("requireAdmin");
  });
});
