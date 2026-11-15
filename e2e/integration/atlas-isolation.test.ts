/**
 * Intégration (vraie base PostgreSQL de la CI) : les données Atlas d'un espace ne sont jamais visibles ni
 * modifiables depuis un autre. Remplace les tests d'isolation de l'ancienne app (entreprises, pipeline),
 * retirée le 15/11. Exige DATABASE_URL (job `integration`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { prisma } from "@/lib/prisma";
import * as seg from "@/atlas/segments";

const IA = { id: "ia:test", via: "mcp" as const };
const id = randomUUID().slice(0, 8);
let A = "";
let B = "";

beforeAll(async () => {
  for (const nom of ["a", "b"]) {
    const u = await prisma.user.create({ data: { email: `atlas-iso-${nom}-${id}@exemple.invalid` } });
    const t = await prisma.tenant.create({ data: { userId: u.id, name: `Atlas iso ${nom}`, slug: `atlas-iso-${nom}-${id}` } });
    if (nom === "a") A = t.id;
    else B = t.id;
  }
});

afterAll(async () => {
  await prisma.atlasEpingle.deleteMany({ where: { tenantId: { in: [A, B] } } });
  const ids = (await prisma.atlasSegment.findMany({ where: { tenantId: { in: [A, B] } }, select: { id: true } })).map((x) => x.id);
  await prisma.atlasScoringVersion.deleteMany({ where: { segmentId: { in: ids } } });
  await prisma.atlasSegmentVersion.deleteMany({ where: { segmentId: { in: ids } } });
  await prisma.atlasSegment.deleteMany({ where: { tenantId: { in: [A, B] } } });
  await prisma.atlasDossier.deleteMany({ where: { tenantId: { in: [A, B] } } });
  await prisma.$disconnect();
});

describe("isolation des données Atlas entre espaces", () => {
  test("un segment de A n'apparaît pas chez B et ne s'y lit, modifie ni supprime pas", async () => {
    const d = await seg.creerDossier(A, "Dossier A");
    const s = await seg.creerSegment(A, { nom: "Marché A", filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] }, dossierId: d.id }, IA);
    expect((await seg.listerArbre(A)).segments.map((x) => x.id)).toContain(s.id);
    expect((await seg.listerArbre(B)).segments).toHaveLength(0);
    await expect(seg.lireSegment(B, s.id)).rejects.toThrow(seg.Introuvable);
    await expect(seg.modifierSegment(B, s.id, { nom: "piraté" }, IA)).rejects.toThrow(seg.Introuvable);
    await expect(seg.supprimerSegment(B, s.id)).rejects.toThrow(seg.Introuvable);
    expect((await seg.lireSegment(A, s.id)).nom).toBe("Marché A");
  });

  test("les épingles de A restent à A", async () => {
    await seg.epingler(A, { siren: "123456789", nom: "Entreprise A" }, IA);
    expect((await seg.listerEpingles(A)).map((e) => e.siren)).toContain("123456789");
    expect(await seg.listerEpingles(B)).toHaveLength(0);
  });
});
