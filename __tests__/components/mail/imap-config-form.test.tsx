/**
 * Source-level test pour src/components/mail/imap-config-form.tsx.
 *
 * Sabotage-test : si on remplace fetch("/api/mail/imap-config") par fetch("/api/mail/config"),
 * le test "fetch sur la bonne route" rougirait.
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("imap-config-form.tsx — anti-régression flow IMAP UI", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/mail/imap-config-form.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("fetch sur /api/mail/imap-config (GET state initial)", () => {
    expect(source).toMatch(/fetch\(\s*["']\/api\/mail\/imap-config["']/);
  });

  test("PUT pour sauvegarder + test-imap-connection pour tester", () => {
    expect(source).toMatch(/method:\s*["']PUT["']/);
    expect(source).toMatch(/\/api\/mail\/test-imap-connection/);
  });

  test("DELETE pour désactiver IMAP", () => {
    expect(source).toMatch(/method:\s*["']DELETE["']/);
  });

  test("password n'est jamais envoyé si vide (rotation safe)", () => {
    // L'UI doit conditionnellement ajouter `payload.password = config.password`
    // dans un if (config.password). Sinon on écrase un password configuré par
    // une string vide → bug critique.
    expect(source).toMatch(/if\s*\(\s*config\.password\s*\)/);
  });

  test("affiche le badge ✓ configuré quand password en DB", () => {
    expect(source).toMatch(/passwordConfigured/);
    expect(source).toMatch(/✓ configuré/);
  });

  test("dossier IMAP par défaut INBOX", () => {
    expect(source).toMatch(/folder:\s*["']INBOX["']/);
  });
});
