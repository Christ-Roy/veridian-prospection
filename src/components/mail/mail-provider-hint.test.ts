/**
 * Tests source-level pour MailProviderHint.
 *
 * Pas de @testing-library dans ce repo (cf inbox-list.test.ts). On lit le
 * fichier source et on vérifie que :
 *  - le composant retourne null si provider sans app password
 *  - le CTA cible target="_blank" + rel sécurisé
 *  - l'accordéon guide est toggleable (state local)
 *  - les data-testid critiques sont exposés pour E2E
 *
 * Run: npx vitest run src/components/mail/mail-provider-hint.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("MailProviderHint — contrats UI", () => {
  const src = read("src/components/mail/mail-provider-hint.tsx");

  it("retourne null si provider null ou requiresAppPassword false", () => {
    expect(src).toMatch(
      /if \(!provider \|\| !provider\.requiresAppPassword\) return null/,
    );
  });

  it("CTA App Password ouvre l'URL en _blank avec rel sécurisé", () => {
    expect(src).toContain('target="_blank"');
    expect(src).toContain('rel="noopener noreferrer"');
    expect(src).toContain("provider.appPasswordUrl");
  });

  it("expose data-testid mail-provider-hint sur le conteneur racine", () => {
    expect(src).toContain('data-testid="mail-provider-hint"');
    expect(src).toContain("data-provider={provider.id}");
  });

  it("expose data-testid pour le CTA et le toggle guide", () => {
    expect(src).toContain('data-testid="mail-provider-app-password-cta"');
    expect(src).toContain('data-testid="mail-provider-toggle-guide"');
    expect(src).toContain('data-testid="mail-provider-guide-steps"');
  });

  it("rend les steps du guide en liste ordonnée", () => {
    expect(src).toContain("appPasswordGuide.steps.map");
    expect(src).toContain("<ol");
    expect(src).toContain("list-decimal");
  });

  it("toggle guide via useState (showGuide)", () => {
    expect(src).toContain("useState(false)");
    expect(src).toContain("setShowGuide");
    expect(src).toContain("aria-expanded={showGuide}");
  });

  it("bandeau amber (style cohérent avec le warning anti-spam SMTP)", () => {
    expect(src).toMatch(/bg-amber-50|border-amber-300/);
  });
});
