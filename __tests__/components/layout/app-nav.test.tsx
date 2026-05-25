/**
 * Tests source-level sur src/components/layout/app-nav.tsx.
 *
 * Anti-régression des fixes UI mobile 2026-05-22 :
 *  - Fix #1 : entre md et lg, les libellés de la nav passent en
 *    icônes-seules (`hidden lg:inline`) pour que le header ne déborde
 *    plus en 768-1000px sur /prospects (toggle site + 7 liens).
 *  - Fix #4 : le toggle « avec/sans site » a été ajouté au menu
 *    hamburger mobile — il n'était accessible que dans la nav desktop.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 */
import { describe, expect, test } from "vitest";

describe("app-nav.tsx — responsive header + toggle mobile (2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/layout/app-nav.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Fix #1 — libellés masqués entre md et lg pour éviter le débordement.
  test("les libellés de nav passent en icônes-seules sous lg", () => {
    expect(source).toMatch(/hidden lg:inline/);
  });

  // Fix #4 — toggle site dans le menu hamburger mobile.
  test("le menu hamburger mobile contient le toggle site", () => {
    expect(source).toMatch(/data-testid="site-toggle-mobile"/);
  });

  test("le toggle mobile a ses 3 entrées (all / with / without)", () => {
    expect(source).toMatch(/data-testid="site-toggle-mobile-all"/);
    expect(source).toMatch(/data-testid="site-toggle-mobile-with"/);
    expect(source).toMatch(/data-testid="site-toggle-mobile-without"/);
  });

  test("le toggle desktop site-toggle existe toujours (sanity, couvert e2e)", () => {
    // prospects-full-flow.spec.ts cible ce testid au viewport desktop.
    expect(source).toMatch(/data-testid="site-toggle"/);
  });

  test("conserve l'export AppNav et le menu hamburger md:hidden (sanity)", () => {
    expect(source).toMatch(/export function AppNav/);
    expect(source).toMatch(/md:hidden/);
  });

  // Anti-régression hotfix 2026-05-23 : bug prod où un user arrivé via
  // token Hub n'avait aucun moyen visible de se déconnecter pour utiliser
  // un autre compte. Le bouton signOut doit rester accessible — sinon la
  // pratique démo / machine partagée / switch tenant est bloquée.
  test("expose un bouton signOut (LogOut + handleSignOut)", () => {
    // L'import explicite de signOut Auth.js v5 prouve qu'on utilise le bon
    // mécanisme, pas un fetch maison.
    expect(source).toMatch(/import\s+{[^}]*signOut[^}]*}\s+from\s+["']next-auth\/react["']/);
    // L'icône LogOut de lucide identifie le bouton dans la nav.
    expect(source).toMatch(/import\s+{[^}]*\bLogOut\b/);
    // Le handler doit appeler signOut avec callbackUrl /login pour ne pas
    // laisser l'user sur une page authentifiée après déconnexion.
    expect(source).toMatch(/signOut\(\s*\{[^}]*callbackUrl:\s*["']\/login["']/);
  });

  test("expose le bouton signOut en desktop (à côté de NotificationBell)", () => {
    // Reconnaît la zone : <LogOut /> wrappée dans un button avec hidden md:inline-flex
    // (desktop only — mobile l'a dans le burger).
    expect(source).toMatch(/hidden md:inline-flex/);
    expect(source).toMatch(/<LogOut className/);
  });

  test("expose le bouton signOut dans le menu mobile (burger) avec l'email", () => {
    // Le menu mobile doit afficher l'email courant ("Connecté : X")
    // et un bouton "Se déconnecter".
    expect(source).toMatch(/Connect[ée]\s*:/);
    expect(source).toMatch(/Se d[ée]connecter/);
  });
});

describe("app-nav.tsx — guard défensif setSettings (audit setters 2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/layout/app-nav.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Bug latent identique au ticket bug-intermittent : si /api/settings
  // renvoie 401/500/HTML, `setSettings(Response)` ou `setSettings(undefined)`
  // casserait `settings[item.settingKey] === "true"` au render. Le pattern
  // doit aller chercher r.ok puis .json() puis .catch.
  test("fetch /api/settings appelle .json() (jamais setSettings sur Response brute)", () => {
    // Le pattern dangereux historique : .then(setSettings) direct sur Response.
    expect(source).not.toMatch(/fetch\(\s*["']\/api\/settings["']\s*\)\s*\.then\(\s*setSettings\s*\)/);
    // Le pattern attendu : .then(r => r.ok ? r.json() : {}).then(setSettings)
    expect(source).toMatch(/fetch\(\s*["']\/api\/settings["']\s*\)\s*\.then\(\s*\(r\)\s*=>\s*r\.ok\s*\?\s*r\.json\(\)\s*:\s*\{\}\s*\)/);
  });

  test("le fetch /api/settings a un .catch fallback pour ne pas bruiter unhandledrejection", () => {
    // Extrait la chaîne fetch("/api/settings")...; jusqu'au prochain ; et
    // vérifie qu'elle contient .catch.
    const m = source.match(/fetch\(\s*["']\/api\/settings["']\s*\)[\s\S]*?;/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/\.catch\(/);
  });

  // Sabotage-check : retirer le .catch ou le guard r.ok casserait ces tests.
  test("aucun setSettings non-gardé sur la Response brute", () => {
    expect(source).not.toMatch(/\.then\(\s*setSettings\s*\)(?![\s\S]*\.then)/);
  });
});

describe("app-nav.tsx — badge solde leads perma-visible (2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/layout/app-nav.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Ticket refill leads UI — le solde doit être visible en perma à côté du
  // NotificationBell (decision Robert 2026-05-22 : solde POSITIF rassurant).
  test("importe LeadsBalanceBadge depuis components/dashboard", () => {
    expect(source).toMatch(
      /import\s*\{\s*LeadsBalanceBadge\s*\}\s*from\s*["']@\/components\/dashboard\/leads-balance-badge["']/,
    );
  });

  test("badge desktop rendu hidden sm:inline-flex (caché < sm pour ne pas surcharger)", () => {
    // Mobile a sa propre section dédiée dans le burger.
    expect(source).toMatch(/<LeadsBalanceBadge[^>]*hidden sm:inline-flex/);
  });

  test("section mobile burger : lien Mes leads → /settings/leads avec badge", () => {
    expect(source).toMatch(/data-testid="nav-mobile-leads-link"/);
    expect(source).toMatch(/href="\/settings\/leads"/);
  });
});

describe("app-nav.tsx — badge trial gated par plan (audit trial résidus 2026-05-24)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/layout/app-nav.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Le badge "Essai gratuit — Xj" doit DISPARAÎTRE pour un user payant.
  // `/api/trial` renvoie daysLeft=999 pour pro/business/enterprise/gifted ;
  // on s'appuie sur `daysLeft < 900` comme gate (la valeur 900 est un seuil
  // arbitraire bien au-dessus de tout trial réel — TRIAL_DAYS max = 30).
  test("expose un gate `showTrialBadge` basé sur daysLeft < 900", () => {
    expect(source).toMatch(/const\s+showTrialBadge\s*=\s*daysLeft\s*<\s*900/);
  });

  // Le badge "Essai gratuit" ne doit plus exister sans condition au render.
  // On exige que la div du badge soit wrappée dans `{showTrialBadge && ...}`.
  test("le badge `Essai gratuit` est wrappé dans `showTrialBadge &&`", () => {
    expect(source).toMatch(/\{showTrialBadge\s*&&\s*\(/);
  });

  // Sabotage : si quelqu'un retire le gating et remet le badge en
  // permanence, ce test casse.
  test("le label `Essai gratuit` ne doit jamais être rendu hors du gate", () => {
    // On vise le label rendu (template literal JSX), pas les occurrences
    // dans les commentaires d'audit qui décrivent justement ce gate.
    // Le label rendu est : `Essai gratuit — ${daysLeft}j`.
    const labelPattern = /`Essai gratuit\s+—\s+\$\{daysLeft\}j`/;
    const matchLabel = source.match(labelPattern);
    expect(matchLabel).not.toBeNull();
    const idxGate = source.indexOf("const showTrialBadge");
    expect(idxGate).toBeGreaterThan(-1);
    // Le label rendu DOIT apparaître APRÈS la déclaration du gate
    // (sinon il est rendu avant d'être gated → impossible structurellement).
    expect(matchLabel!.index!).toBeGreaterThan(idxGate);
  });
});
