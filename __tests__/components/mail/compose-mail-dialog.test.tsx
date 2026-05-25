/**
 * Tests source-level de compose-mail-dialog.tsx.
 *
 * Invariants critiques :
 *  - Le siren du prospect est tracé côté serveur (sinon timeline 360 vide)
 *  - La modale propose les 2 templates v1 via listTemplates()
 *  - Pas de password / credential envoyé côté client (la route le gère)
 *  - Réagit aux 412 (SMTP non configuré) avec un lien vers /settings/mail
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SRC = resolve(
  process.cwd(),
  "src/components/mail/compose-mail-dialog.tsx",
);

describe("compose-mail-dialog.tsx — invariants v1", () => {
  let source = "";

  test("setup", async () => {
    source = await readFile(SRC, "utf-8");
    expect(source.length).toBeGreaterThan(0);
  });

  test("POST sur /api/mail/send (pas un autre endpoint)", () => {
    expect(source).toMatch(/["']\/api\/mail\/send["']/);
  });

  test("inclut le siren dans le payload (timeline 360°)", () => {
    expect(source).toMatch(/siren\s*:\s*siren/);
  });

  test("charge la liste templates via /api/mail/templates (customs + fallbacks)", () => {
    // v2 (2026-05-25, ticket follow-ups §A) : templates customs par tenant
    // → le client fetch /api/mail/templates au mount (vs ancien import statique
    // listTemplates() qui ne voyait que les fallbacks hardcodés).
    expect(source).toMatch(/\/api\/mail\/templates/);
  });

  test("offre l'option 'Compose libre' (FREEFORM)", () => {
    expect(source).toMatch(/FREEFORM/);
  });

  test("gère le 412 (SMTP non configuré) avec lien /settings/mail", () => {
    expect(source).toMatch(/412/);
    expect(source).toMatch(/\/settings\/mail/);
  });

  test("désactive le bouton 'Envoyer' si destinataire vide", () => {
    expect(source).toMatch(/disabled=\{[^}]*!to/);
  });

  test("rend preview du template via renderTemplate (variables résolues côté client)", () => {
    // L'user voit ce qu'il envoie avant d'envoyer — pas de surprise.
    expect(source).toMatch(/renderTemplate/);
  });

  test("ne stocke ni n'envoie jamais le password SMTP côté client", () => {
    // Le password vit uniquement serveur (DB chiffré). La modale ne doit
    // JAMAIS le toucher (sinon XSS-leak).
    expect(source).not.toMatch(/smtpPassword/i);
    expect(source).not.toMatch(/passwordEnc/);
  });
});
