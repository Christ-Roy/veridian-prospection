/**
 * Schema invariants — anti-régression sur les tables/modèles supprimés.
 *
 * Chaque DROP TABLE dette tech doit laisser un test qui casse si quelqu'un
 * re-crée par erreur le modèle Prisma correspondant (et donc, indirectement,
 * la table après `prisma migrate dev`).
 *
 * Ce fichier est l'index single-source-of-truth des modèles bannis.
 * Ajoute une entrée à `BANNED_MODELS` à chaque sprint de dette destructive
 * (cf. todo/2026-05-20-dette-tech-db-destructive-sprints.md).
 */
import { describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";

const BANNED_MODELS = [
  // Sprint A (T9, 2026-05-21) — DROP TABLE outreach_emails
  // Migration : prisma/migrations/0012_drop_outreach_emails/
  // Raison : table vidée commit 61427f9, plus aucun writer/reader, 0 rows prod.
  "OutreachEmail",
] as const;

describe("Prisma schema invariants — modèles bannis", () => {
  for (const modelName of BANNED_MODELS) {
    test(`le modèle "${modelName}" ne doit jamais réapparaître dans Prisma Client`, () => {
      // Prisma.ModelName est l'enum runtime listant tous les modèles du schema.
      // Si on réintroduit le modèle, l'enum le contient → ce test casse.
      const modelNames = Object.values(Prisma.ModelName) as string[];
      expect(modelNames).not.toContain(modelName);
    });
  }
});
