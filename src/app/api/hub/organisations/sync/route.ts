/**
 * Document d'organisation du Hub (VER-252) : une seule configuration, au Hub, qu'Atlas reçoit et relit.
 * `POST` applique (nom, type, marque, membres), `GET ?hub_tenant_id=` rend la version servie.
 *
 * Version monotone : une plus ancienne ou la même n'écrit rien. La liste des membres est additive : une absence ne retire
 * personne (le retrait est `remove-member`), et un membre retiré ici ne revient que par une adhésion plus récente.
 * Atlas n'ajoute aucun réglage d'organisation à lui.
 */
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveOrCreateUserFromHub } from "@/lib/hub/identity";
import { verifierAppelHub } from "@/lib/hub/secrets";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const COULEUR = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish();
const LOGO = z.string().url().max(500).regex(/^https:\/\//).nullish();
const Document = z.object({
  hub_tenant_id: z.string().uuid(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nom: z.string().trim().min(1).max(200),
  type: z.enum(["individuel", "organisation"]),
  marque: z.object({ nom_affiche: z.string().trim().max(200).nullish(), logo_url: LOGO, couleur_primaire: COULEUR, couleur_accent: COULEUR }),
  membres: z
    .array(z.object({ hub_user_id: z.string().uuid(), email: z.string().email().max(254), email_proven: z.literal(true), role: z.string().max(40), joined_at: z.string().datetime({ offset: true }) }))
    .max(2000),
});

type Organisation = { version: number; nom: string; type: string; marque: z.infer<typeof Document>["marque"] };
const objet = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const versionDe = (metadata: unknown): number | null => {
  const v = objet(objet(metadata).organisation).version;
  return typeof v === "number" ? v : null;
};
/** Rôle d'organisation vers rôle d'Atlas. Un rôle inconnu ne donne que la lecture. */
const ROLE: Record<string, string> = { owner: "admin", admin: "admin", member: "member", viewer: "viewer" };

const rendre = (corps: unknown, status = 200) => NextResponse.json(corps, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const v = verifierAppelHub(request, "");
  if (!v.ok) return rendre({ error: "Unauthorized" }, 401);
  const id = request.nextUrl.searchParams.get("hub_tenant_id") ?? "";
  if (!z.string().uuid().safeParse(id).success) return rendre({ error: "hub_tenant_id invalide" }, 400);
  const t = await prisma.tenant.findFirst({ where: { hubTenantId: id.toLowerCase(), deletedAt: null }, select: { metadata: true } });
  if (!t) return rendre({ error: "tenant_not_linked" }, 404);
  return rendre({ hub_tenant_id: id.toLowerCase(), version: versionDe(t.metadata) });
}

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;
  const d = Document.safeParse(auth.body);
  if (!d.success) return rendre({ error: "invalid_payload", issues: d.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, 400);
  const doc = d.data;
  const hubTenantId = doc.hub_tenant_id.toLowerCase();

  const tenant = await prisma.tenant.findFirst({ where: { hubTenantId, deletedAt: null }, select: { id: true, metadata: true } });
  if (!tenant) return rendre({ error: "tenant_not_linked" }, 404);
  const servie = versionDe(tenant.metadata);
  if (servie !== null && doc.version <= servie) return rendre({ applied: false, reason: doc.version === servie ? "unchanged" : "stale" });

  // Les membres d'abord : la version n'est servie qu'une fois leur liste appliquée.
  const refuses = await ajouterMembres(tenant.id, doc.membres);

  const applique = await prisma.$transaction(async (tx) => {
    const [l] = await tx.$queryRaw<{ metadata: unknown }[]>`SELECT metadata FROM tenants WHERE id = ${tenant.id}::uuid FOR UPDATE`;
    const v = versionDe(l?.metadata);
    if (v !== null && doc.version <= v) return false; // une version plus récente est passée entre-temps
    const organisation: Organisation = { version: doc.version, nom: doc.nom, type: doc.type, marque: doc.marque };
    await tx.tenant.update({ where: { id: tenant.id }, data: { name: doc.nom, metadata: { ...objet(l?.metadata), organisation } as Prisma.InputJsonValue } });
    return true;
  });
  invalidateAllUserContexts();
  console.log(`[hub/organisations/sync] tenant=${tenant.id} version=${doc.version} applique=${applique} membres=${doc.membres.length} refuses=${refuses}`);
  return rendre(applique ? { applied: true, version: doc.version, refuses } : { applied: false, reason: "stale" });
}

/** Ajoute les absents, relève un membre retiré seulement si son adhésion est postérieure. Rend le nombre de refus. */
async function ajouterMembres(tenantId: string, membres: z.infer<typeof Document>["membres"]): Promise<number> {
  if (!membres.length) return 0;
  const w =
    (await prisma.workspace.findFirst({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.workspace.create({ data: { tenantId, name: "Default", slug: "default" }, select: { id: true } }));
  let refuses = 0;
  for (const m of membres) {
    try {
      const hubUserId = m.hub_user_id.toLowerCase();
      const { id } = await resolveOrCreateUserFromHub({ hubUserId, email: m.email.toLowerCase(), emailProven: true });
      // Une adresse déjà liée à une autre identité du Hub ne fait entrer personne à sa place.
      const lie = await prisma.user.findUnique({ where: { id }, select: { hubUserId: true, deletedAt: true } });
      if (lie?.hubUserId?.toLowerCase() !== hubUserId || lie.deletedAt) throw new Error("identite_differente");
      const role = ROLE[m.role] ?? "viewer";
      const cle = { workspaceId_userId: { workspaceId: w.id, userId: id } };
      const f = await prisma.workspaceMember.findUnique({ where: cle, select: { deletedAt: true } });
      if (!f) await prisma.workspaceMember.create({ data: { workspaceId: w.id, userId: id, role, joinedAt: new Date(m.joined_at) } });
      else if (f.deletedAt && Date.parse(m.joined_at) > f.deletedAt.getTime()) await prisma.workspaceMember.update({ where: cle, data: { role, deletedAt: null, joinedAt: new Date(m.joined_at) } });
      // Présent : son rôle ne change que par le chemin des rôles du Hub.
    } catch (e) {
      refuses++;
      console.warn(`[hub/organisations/sync] membre refusé tenant=${tenantId} hub_user=${m.hub_user_id} : ${e instanceof Error ? e.message.slice(0, 60).replace(/\S+@\S+/g, "") : "erreur"}`);
    }
  }
  return refuses;
}
