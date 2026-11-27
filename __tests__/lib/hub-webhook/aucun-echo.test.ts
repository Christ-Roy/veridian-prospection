/**
 * Le Hub est la source des comptes et des membres (parente et Hub, 27/11) : il note lui-même l'issue de ses ordres
 * (soft-delete, remove-member) à la réponse synchrone. Prospection ne lui renvoie plus d'écho, et plus rien n'écrit
 * dans la file `webhook_outbox` (783 lignes jamais envoyées depuis le 19/06, archivées le 27/11). Ce test refuse leur retour.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");
const fichiers = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

test("aucun code n'écrit dans webhook_outbox ni n'émet d'écho de compte ou de membre vers le Hub", () => {
  const fautifs = fichiers(SRC)
    .map((f) => [path.relative(SRC, f), readFileSync(f, "utf8")] as const)
    .filter(([, t]) => /webhookOutbox|enqueueEvent|hub-webhook\/outbox|"tenant\.(soft_deleted|purged|member_added|member_removed)"/.test(t))
    .map(([f]) => f);
  expect(fautifs).toEqual([]);
});
