/**
 * Tests source-level de mail-config-form.tsx.
 *
 * Pourquoi pas un render React + interactions ? Le composant fait des fetch
 * réels au mount et gère un state complexe (loading, saving, testing). Le
 * test critique ici est anti-régression : on ne doit JAMAIS envoyer le
 * password en clair en GET, jamais l'afficher dans le DOM, jamais le
 * persister hors HTTPS. Sabotage-test : retirer `type="password"` du champ
 * password → le test password-field-typed casse.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SRC = resolve(process.cwd(), "src/components/mail/mail-config-form.tsx");

describe("mail-config-form.tsx — anti-régression sécurité", () => {
  let source = "";

  test("setup", async () => {
    source = await readFile(SRC, "utf-8");
    expect(source.length).toBeGreaterThan(0);
  });

  test("le champ password utilise type=\"password\" (pas plain text)", () => {
    // Sabotage : si quelqu'un passe en type="text" pour debug et oublie
    // de le remettre, ce test rougit.
    expect(source).toMatch(/id="password"[\s\S]*?type="password"/);
  });

  test("PUT /api/mail/config — pas de password en query string ni en URL", () => {
    // Le password doit transiter UNIQUEMENT dans le body JSON, jamais en
    // search params (qui finissent dans les logs serveur + history navigateur).
    expect(source).not.toMatch(/password=\$\{/);
    expect(source).not.toMatch(/\?password=/);
  });

  test("affiche '✓ configuré' quand passwordConfigured + champ vide (pattern UX safe)", () => {
    // Pattern : on ne révèle JAMAIS le password existant — on indique
    // juste qu'il est en DB. Si l'user veut le rotate, il saisit un nouveau.
    expect(source).toMatch(/passwordConfigured\s*&&[^}]*configur/);
  });

  test("envoie payload.password UNIQUEMENT si l'user en a saisi un (pattern rotation hors password)", () => {
    expect(source).toMatch(/if\s*\(config\.password\)/);
  });

  test("propose un bouton 'Tester la connexion' (UX safety net)", () => {
    expect(source).toContain("Tester la connexion");
  });

  test("affiche un encart DKIM/SPF (responsabilité user vs spam)", () => {
    // Sans ce reminder, l'user envoie depuis SMTP non configuré DNS-side
    // et tombe dans les spams Gmail → support tickets garantis.
    expect(source).toMatch(/DKIM/);
    expect(source).toMatch(/SPF/);
  });
});
