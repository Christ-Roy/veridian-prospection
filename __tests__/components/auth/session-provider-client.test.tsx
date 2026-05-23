/**
 * Test source-level sur src/components/auth/session-provider-client.tsx.
 *
 * Wrapper trivial mais STRUCTUREL : sans ce SessionProvider injecté dans
 * src/app/layout.tsx, useSession() ne fonctionne pas dans les composants
 * client (app-nav, /login). C'est exactement ce qui a causé le bug prod
 * 2026-05-23 : pas de bouton signOut visible côté UI.
 *
 * Si quelqu'un supprime ce wrapper ou le retire du layout, ce test rougit.
 */
import { describe, expect, test } from "vitest";

describe("session-provider-client.tsx — wrapper Auth.js v5", () => {
  let source = "";
  let layoutSource = "";

  test("setup : lecture des sources", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/components/auth/session-provider-client.tsx",
      ),
      "utf-8",
    );
    layoutSource = await fs.readFile(
      path.resolve(process.cwd(), "src/app/layout.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
    expect(layoutSource.length).toBeGreaterThan(0);
  });

  test("est marqué 'use client' (sinon SessionProvider crash en SSR)", () => {
    expect(source).toMatch(/^["']use client["']/m);
  });

  test("importe SessionProvider depuis next-auth/react", () => {
    expect(source).toMatch(
      /import\s+{\s*SessionProvider\s*}\s+from\s+["']next-auth\/react["']/,
    );
  });

  test("exporte SessionProviderClient qui wrap children", () => {
    expect(source).toMatch(/export function SessionProviderClient/);
    expect(source).toMatch(/<SessionProvider>{children}<\/SessionProvider>/);
  });

  // Anti-régression du bug prod 2026-05-23 : si le wrapper n'est pas
  // appliqué dans le root layout, useSession() retourne undefined partout
  // → pas de bouton signOut, pas de bandeau /login, pas de UX logout.
  test("est appliqué dans src/app/layout.tsx", () => {
    expect(layoutSource).toMatch(
      /import\s+{\s*SessionProviderClient\s*}\s+from\s+["']@\/components\/auth\/session-provider-client["']/,
    );
    expect(layoutSource).toMatch(/<SessionProviderClient>/);
    expect(layoutSource).toMatch(/<\/SessionProviderClient>/);
  });
});
