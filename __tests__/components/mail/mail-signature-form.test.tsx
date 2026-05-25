/**
 * Tests source-level pour MailSignatureForm.
 *
 * Pattern Veridian : pas de @testing-library, on lit le source et on
 * vérifie les invariants critiques qui ne PEUVENT PAS être supprimés
 * sans casser le contrat user-visible :
 *  - GET /api/mail/signature au mount (charge l'état)
 *  - PUT /api/mail/signature avec body { mailSignatureHtml, mailSignatureEnabled }
 *  - Preview live via dangerouslySetInnerHTML (l'user voit le rendu)
 *  - Checkbox "enabled" pilote le mailSignatureEnabled
 *  - data-testid pour E2E hooks
 *  - Pas de password / credential leak côté client (cohérence avec
 *    pattern existant mail-config-form)
 *
 * Run: npx vitest run __tests__/components/mail/mail-signature-form.test.tsx
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(
  process.cwd(),
  "src/components/mail/mail-signature-form.tsx",
);

describe("MailSignatureForm — contrats UI signature", () => {
  const src = readFileSync(SRC, "utf8");

  it("charge la config existante via GET /api/mail/signature au mount", () => {
    // useEffect avec fetch au chargement.
    expect(src).toContain('fetch("/api/mail/signature")');
    expect(src).toMatch(/useEffect\(/);
  });

  it("sauvegarde via PUT /api/mail/signature avec le payload contractuel", () => {
    // Le payload doit contenir EXACTEMENT les 2 champs attendus côté
    // route (cf src/app/api/mail/signature/route.ts zod schema).
    expect(src).toMatch(/method:\s*["']PUT["']/);
    expect(src).toContain("mailSignatureHtml");
    expect(src).toContain("mailSignatureEnabled");
  });

  it("envoie mailSignatureHtml=null si textarea vide (vs string vide)", () => {
    // Cohérence avec le schema : null = pas de signature. Une string vide
    // serait acceptée mais polluerait l'audit log avec "htmlLength=0".
    expect(src).toMatch(/state\.html\.trim\(\)\s*\|\|\s*null/);
  });

  it("expose preview live via dangerouslySetInnerHTML — l'user voit le rendu HTML", () => {
    // Sans la preview live, l'user envoie sa signature à l'aveugle. C'est
    // un invariant UX. Si on retire le dangerouslySetInnerHTML, on doit
    // remettre AU MOINS un iframe ou un autre rendu visuel équivalent.
    expect(src).toContain("dangerouslySetInnerHTML");
    expect(src).toContain('data-testid="signature-preview"');
  });

  it("Checkbox enabled pilote mailSignatureEnabled (toggle on/off)", () => {
    // L'user peut désactiver sans perdre le contenu.
    expect(src).toContain('id="signature-enabled"');
    expect(src).toContain("checked={state.enabled}");
    expect(src).toContain("enabled:");
  });

  it("expose data-testid pour le bouton Sauvegarder (E2E hook)", () => {
    expect(src).toContain('data-testid="signature-save"');
  });

  it("ne touche jamais aux credentials SMTP / passwordEnc (séparation des préoccupations)", () => {
    // Le form signature ne lit ni n'écrit smtp_password — il vit dans
    // un onglet séparé (cf mail-config-form). Toute apparition de
    // password ici serait suspect (couplage non voulu, fuite potentielle).
    expect(src).not.toMatch(/smtpPassword/i);
    expect(src).not.toMatch(/passwordEnc/);
  });
});
