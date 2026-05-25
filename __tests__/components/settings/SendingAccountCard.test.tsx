/**
 * Tests source-level sur src/components/settings/SendingAccountCard.tsx.
 *
 * Pattern Veridian : on lit le source brut et on vérifie les invariants
 * critiques (présence des 3 états, gating admin, gestion erreurs, etc.)
 * sans monter un DOM React (jsdom n'est pas configuré globalement, et le
 * pattern existant pour les composants critiques est source-level).
 *
 * Invariants vérifiés :
 *  - 3 états UI : 'none' / 'gmail-via-hub' / needs_reauth (via toast)
 *  - Gating admin : POST disable si !isAdmin
 *  - Fetch /api/mail/sending-account au mount
 *  - Toggle via POST /api/mail/sending-account
 *  - Test envoi via POST /api/mail/send (mail à soi)
 *  - Redirect Hub vers ${HUB_URL}/dashboard/settings/mail?return=...
 *  - Lecture NEXT_PUBLIC_HUB_URL avec fallback prod
 *  - Toasts d'erreur pour needs_reauth, provider_not_linked
 *  - Confirm() avant disconnect (anti-clic accidentel)
 */
import { describe, expect, test } from "vitest";

describe("SendingAccountCard.tsx — invariants critiques", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/components/settings/SendingAccountCard.tsx",
      ),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("export named SendingAccountCard", () => {
    expect(source).toMatch(/export function SendingAccountCard/);
  });

  test("client component ('use client')", () => {
    expect(source).toMatch(/^"use client"/m);
  });

  test("fetch /api/mail/sending-account au mount", () => {
    expect(source).toMatch(/fetch\(\s*["']\/api\/mail\/sending-account["']\s*\)/);
  });

  test("POST /api/mail/sending-account pour toggle", () => {
    expect(source).toMatch(/fetch\(\s*["']\/api\/mail\/sending-account["'][\s\S]*method:\s*["']POST["']/);
  });

  test("POST /api/mail/send pour bouton 'Tester'", () => {
    expect(source).toMatch(/fetch\(\s*["']\/api\/mail\/send["'][\s\S]*method:\s*["']POST["']/);
  });

  test("Redirect Hub via HUB_URL + /dashboard/settings/mail + return query", () => {
    expect(source).toMatch(/HUB_URL/);
    expect(source).toMatch(/\/dashboard\/settings\/mail\?return=/);
    expect(source).toMatch(/encodeURIComponent/);
  });

  test("Fallback NEXT_PUBLIC_HUB_URL → app.veridian.site", () => {
    expect(source).toMatch(/NEXT_PUBLIC_HUB_URL/);
    expect(source).toMatch(/app\.veridian\.site/);
  });

  test("État 'gmail-via-hub' : affiche email + badge Actif", () => {
    expect(source).toMatch(/Gmail connecté/);
    expect(source).toMatch(/state\.email/);
    expect(source).toMatch(/Actif/);
  });

  test("État 'none' : bouton 'Connecter mon Gmail'", () => {
    expect(source).toMatch(/Connecter mon Gmail/);
    expect(source).toMatch(/Aucun compte d&apos;envoi connecté/);
  });

  test("Gating admin : boutons sensibles uniquement si isAdmin", () => {
    // 2 occurrences attendues : connect/enable + disconnect
    const matches = source.match(/state\.isAdmin/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/Seul un administrateur peut connecter/);
  });

  test("confirm() avant disconnect (anti-clic accidentel)", () => {
    expect(source).toMatch(/confirm\(\s*["']Désactiver l['']envoi via Gmail/);
  });

  test("Toast erreur explicite si needs_reauth (handleTest)", () => {
    expect(source).toMatch(/needs_reauth/);
    expect(source).toMatch(/Reconnexion Gmail requise/);
  });

  test("Toast erreur explicite si provider_not_linked (handleTest)", () => {
    expect(source).toMatch(/provider_not_linked/);
    expect(source).toMatch(/Aucun Gmail connecté côté Hub/);
  });

  test("State loading distinct (Loader2 + Chargement)", () => {
    expect(source).toMatch(/Loader2/);
    expect(source).toMatch(/Chargement/);
  });

  test("Affiche quota Gmail (250 standard, 2000 Workspace)", () => {
    expect(source).toMatch(/gmailQuotaPerDay/);
    expect(source).toMatch(/250/);
    expect(source).toMatch(/2000/);
  });

  test("Affichage date connectedAt en locale fr-FR", () => {
    expect(source).toMatch(/toLocaleString\(\s*["']fr-FR["']/);
  });

  test("Lien 'Gérer dans Hub' (ExternalLink)", () => {
    expect(source).toMatch(/Gérer dans Hub/);
    expect(source).toMatch(/ExternalLink/);
  });

  test("Page parente passe par /settings/sending-account", () => {
    expect(source).toMatch(/\/settings\/sending-account/);
  });

  test("Toast succès après activation", () => {
    expect(source).toMatch(/toast\.success/);
    expect(source).toMatch(/Gmail activé comme compte d['']envoi/);
  });

  test("Reset gmailConnectedAt à null au disconnect (UI cohérent)", () => {
    expect(source).toMatch(/gmailConnectedAt: null/);
  });
});

describe("settings/sending-account/page.tsx — entrypoint", () => {
  test("export default + import SendingAccountCard", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/app/settings/sending-account/page.tsx",
      ),
      "utf-8",
    );
    expect(src).toMatch(/import\s+{\s*SendingAccountCard\s*}/);
    expect(src).toMatch(/export default function/);
    expect(src).toMatch(/<SendingAccountCard\s*\/>/);
  });

  test("force-dynamic (server-side rendering)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/app/settings/sending-account/page.tsx",
      ),
      "utf-8",
    );
    expect(src).toMatch(/dynamic\s*=\s*["']force-dynamic["']/);
  });
});
