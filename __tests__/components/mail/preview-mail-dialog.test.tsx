/**
 * Tests source-level pour PreviewMailDialog.
 *
 * Invariants critiques :
 *  - POST /api/mail/render-preview avec includeSignature: true
 *  - Iframe sandbox="allow-same-origin" (PAS allow-scripts — sinon XSS si
 *    l'user copie un bodyHtml malveillant d'un template tiers)
 *  - Affiche un warning si unresolvedVars (l'user voit qu'il manque des vars)
 *  - data-testid pour E2E hooks
 *  - Pas de leak credential dans le body du POST
 *
 * Run: npx vitest run __tests__/components/mail/preview-mail-dialog.test.tsx
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(
  process.cwd(),
  "src/components/mail/preview-mail-dialog.tsx",
);

describe("PreviewMailDialog — contrats UI aperçu mail", () => {
  const src = readFileSync(SRC, "utf8");

  it("POST /api/mail/render-preview pour le rendu serveur", () => {
    // On délègue le rendu au serveur pour garantir la cohérence avec
    // ce qui sera réellement envoyé (vs render client qui diverge).
    expect(src).toContain('"/api/mail/render-preview"');
    expect(src).toMatch(/method:\s*["']POST["']/);
  });

  it("envoie includeSignature: true au render-preview (l'user voit la signature)", () => {
    // Si on retire ce flag, l'aperçu montre le mail sans signature alors
    // que le réel envoi en aura une → effet de surprise pour l'user.
    expect(src).toContain("includeSignature: true");
  });

  it("iframe sandbox='allow-same-origin' UNIQUEMENT (pas allow-scripts → no XSS)", () => {
    // Critique sécurité : un user peut coller du HTML d'un template tiers
    // contenant un <script>. L'iframe doit empêcher l'exécution. La
    // seule capability autorisée est allow-same-origin pour que le
    // doc.write puisse styliser via <style>.
    expect(src).toContain('sandbox="allow-same-origin"');
    expect(src).not.toMatch(/allow-scripts/);
  });

  it("affiche bandeau warning si unresolvedVars détectées", () => {
    // L'user envoie pas un mail avec "{{ prospect.x }}" brut visible
    // chez le destinataire — le warning est la dernière barrière.
    expect(src).toContain("unresolvedVars");
    expect(src).toMatch(/AlertTriangle|Variables non remplies/);
    expect(src).toContain('data-testid="preview-unresolved-warning"');
  });

  it("expose data-testid pour le sujet, l'iframe, le bouton fermer (E2E hooks)", () => {
    expect(src).toContain('data-testid="preview-subject"');
    expect(src).toContain('data-testid="preview-iframe"');
    expect(src).toContain('data-testid="preview-content"');
    expect(src).toContain('data-testid="preview-close"');
  });

  it("ne touche jamais aux credentials SMTP côté client (cohérence isolation)", () => {
    expect(src).not.toMatch(/smtpPassword/i);
    expect(src).not.toMatch(/passwordEnc/);
  });

  it("style preview signature aligné via class veridian-mail-signature", () => {
    // La signature serveur est wrappée dans <div class="veridian-mail-signature">.
    // Le CSS de l'iframe doit avoir ce sélecteur sinon le styling diverge.
    expect(src).toContain(".veridian-mail-signature");
  });
});
