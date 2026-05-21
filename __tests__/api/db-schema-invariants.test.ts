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

// Champs scalaires retirés d'un modèle (mais le modèle existe toujours).
// Le test ci-dessous lit `Prisma.dmmf.datamodel.models` pour garantir qu'aucune
// PR future ne réintroduit silencieusement le champ via `prisma format`.
const BANNED_FIELDS: ReadonlyArray<{
  model: string;
  field: string;
  dbColumn: string;
  reason: string;
}> = [
  {
    // Sprint B (T11, 2026-05-21) — DROP COLUMN tenants.subscription_id
    // Migration : prisma/migrations/0013_drop_tenants_subscription_id/
    model: "Tenant",
    field: "subscriptionId",
    dbColumn: "subscription_id",
    reason:
      "UUID jamais rempli (0 rows non-null staging+prod). Source de vérité Stripe = Hub (contrat §7.4).",
  },
];

describe("Prisma schema invariants — modèles bannis", () => {
  for (const modelName of BANNED_MODELS) {
    test(`le modèle "${modelName}" ne doit jamais réapparaître dans Prisma Client`, () => {
      const modelNames = Object.values(Prisma.ModelName) as string[];
      expect(modelNames).not.toContain(modelName);
    });
  }
});

describe("Prisma schema invariants — champs bannis", () => {
  for (const { model, field, dbColumn, reason } of BANNED_FIELDS) {
    test(`${model}.${field} (col ${dbColumn}) ne doit jamais réapparaître — ${reason}`, () => {
      const target = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
      expect(target, `Modèle Prisma "${model}" introuvable`).toBeDefined();
      const fieldNames = target!.fields.map((f) => f.name);
      const dbColumns = target!.fields.map((f) => f.dbName ?? f.name);
      expect(fieldNames).not.toContain(field);
      expect(dbColumns).not.toContain(dbColumn);
    });
  }
});
