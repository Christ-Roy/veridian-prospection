/**
 * Tests source-level pour MailTemplatesManager.
 *
 * Invariants critiques :
 *  - GET /api/admin/mail-templates au mount (charge la liste)
 *  - POST /api/admin/mail-templates pour create avec payload contractuel
 *  - PUT /api/admin/mail-templates/${id} pour update
 *  - DELETE /api/admin/mail-templates/${id} pour soft-delete
 *  - Branche 409 gérée (slug duplicate)
 *  - confirm() avant DELETE (anti-clic accidentel)
 *  - Slug non éditable après création (l'audit dépend du slug stable)
 *  - data-testid pour E2E hooks
 *
 * Run: npx vitest run __tests__/components/mail/mail-templates-manager.test.tsx
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(
  process.cwd(),
  "src/components/mail/mail-templates-manager.tsx",
);

describe("MailTemplatesManager — contrats UI CRUD templates", () => {
  const src = readFileSync(SRC, "utf8");

  it("charge la liste via GET /api/admin/mail-templates au mount", () => {
    expect(src).toContain('fetch("/api/admin/mail-templates")');
  });

  it("create via POST /api/admin/mail-templates avec body complet", () => {
    // Doit envoyer slug + label + subject + bodyText + bodyHtml — sinon
    // le schema zod côté route refuse en 400.
    expect(src).toMatch(/edit\.template\s*\?\s*["']PUT["']\s*:\s*["']POST["']/);
    expect(src).toMatch(/"\/api\/admin\/mail-templates"/);
    expect(src).toContain("slug:");
    expect(src).toContain("label:");
    expect(src).toContain("subject:");
    expect(src).toContain("bodyText:");
    expect(src).toContain("bodyHtml:");
  });

  it("update via PUT /api/admin/mail-templates/${id} (chemin scopé id)", () => {
    expect(src).toMatch(/\/api\/admin\/mail-templates\/\$\{[^}]*\.id\}/);
    expect(src).toMatch(/"PUT"/);
  });

  it("soft-delete via DELETE /api/admin/mail-templates/${id}", () => {
    expect(src).toMatch(/method:\s*["']DELETE["']/);
  });

  it("gère explicitement la branche 409 conflict (slug duplicate)", () => {
    // L'user qui crée un slug déjà pris doit voir un message clair, pas
    // un échec générique. Si la branche disparaît, l'UX dégrade.
    expect(src).toMatch(/res\.status\s*===\s*409/);
    expect(src).toMatch(/slug existe déjà|already exists/i);
  });

  it("confirm() avant DELETE — anti-clic accidentel", () => {
    // Un soft-delete reste réversible côté DB mais l'UI ne propose pas
    // de undo → confirm est la dernière barrière.
    expect(src).toMatch(/confirm\(/);
  });

  it("slug non éditable après création (disabled si template existe)", () => {
    // Le slug est utilisé dans lead_emails.template_slug pour l'audit
    // — le modifier post-création casserait la traçabilité historique.
    expect(src).toMatch(/disabled=\{!!edit\.template\}/);
  });

  it("expose data-testid pour la liste, bouton new, edit/delete/save (E2E hooks)", () => {
    expect(src).toContain('data-testid="template-list"');
    expect(src).toContain('data-testid="template-new"');
    expect(src).toContain('data-testid="template-save"');
    expect(src).toMatch(/template-edit-\$\{[^}]*\.slug\}/);
    expect(src).toMatch(/template-delete-\$\{[^}]*\.slug\}/);
    expect(src).toMatch(/template-row-\$\{[^}]*\.slug\}/);
  });

  it("affiche le message d'info quand la liste est vide", () => {
    // Sinon l'user pense que le système est cassé. Cohérence UX.
    expect(src).toMatch(/Aucun template custom|empty/i);
  });
});
