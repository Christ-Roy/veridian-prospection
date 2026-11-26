/**
 * Les adresses de l'ancienne app mènent à Atlas, jamais à un 404 nu (26/11 : un compte neuf arrivé sur /prospects ne
 * pouvait ni revenir ni se déconnecter). Aucune redirection ne masque une page d'aujourd'hui.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

import config, { ANCIENNES_PAGES } from "../../next.config";

const app = path.resolve(__dirname, "../../src/app");
const pages = (d: string, base = ""): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    if (!statSync(p).isDirectory()) return f === "page.tsx" ? [base || "/"] : [];
    if (f === "api") return [];
    return pages(p, /^\(.*\)$/.test(f) ? base : `${base}/${f}`);
  });

test("les pages de l'ancienne app redirigent vers Atlas, temporairement", async () => {
  const r = await (config as { redirects: () => Promise<{ source: string; destination: string; permanent: boolean }[]> }).redirects();
  for (const s of ["/prospects", "/pipeline", "/segments/:rest*", "/settings/:rest*", "/admin/:rest*", "/dashboard"]) {
    expect(r).toContainEqual({ source: s, destination: "/", permanent: false });
  }
});

test("aucune redirection ne couvre une page d'aujourd'hui", () => {
  const actuelles = pages(app);
  expect(actuelles).toContain("/marches");
  const prefixes = ANCIENNES_PAGES.map((s) => s.replace(/\/:rest\*$/, ""));
  for (const p of actuelles) expect(`${p} ${prefixes.some((x) => p === x || p.startsWith(`${x}/`))}`).toBe(`${p} false`);
});
