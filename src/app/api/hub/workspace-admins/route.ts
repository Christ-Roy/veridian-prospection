/**
 * Administrateur de plateforme (CONTRAT-HUB §5.23, VER-263), HMAC du Hub §6.1.
 *   POST {workspace_id, hub_user_id, action: "grant"|"revoke", actor_hub_user_id, reason, reinstate}
 *   GET  ?workspace_id=X → {members: [{hub_user_id, role, admin_granted, admin_withdrawn}]}
 * Jamais d'adresse (champ inconnu = 400), rien n'est créé. 404 tenant_not_found | user_not_in_app | not_a_member ;
 * 409 admin_withdrawn | is_owner. Logique : src/lib/hub/admins-plateforme.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireHubHmac } from "@/lib/hub/auth";
import { designerAdmin, listerAdmins, RefusAdmin } from "@/lib/hub/admins-plateforme";
import { verifierAppelHub } from "@/lib/hub/secrets";

const Demande = z
  .object({
    workspace_id: z.string().min(1).max(254),
    hub_user_id: z.string().uuid(),
    action: z.enum(["grant", "revoke"]),
    actor_hub_user_id: z.union([z.string().uuid(), z.string().regex(/^cle:[A-Za-z0-9_-]{1,60}$/)]),
    reason: z.string().max(500).nullish(),
    reinstate: z.boolean().default(false),
  })
  .strict();

const refus = (e: unknown) => {
  if (e instanceof RefusAdmin) return NextResponse.json({ error: e.code }, { status: e.status });
  console.error(`[hub][admins-plateforme] erreur ${e instanceof Error ? e.message.slice(0, 120) : "inconnue"}`);
  return NextResponse.json({ error: "server_error" }, { status: 500 });
};

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;
  const d = Demande.safeParse(auth.body);
  if (!d.success) return NextResponse.json({ error: "invalid_body", message: d.error.issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ; ") }, { status: 400 });
  try {
    return NextResponse.json({ member: await designerAdmin(d.data) });
  } catch (e) {
    return refus(e);
  }
}

export async function GET(request: NextRequest) {
  if (!request.headers.get("x-veridian-hub-signature")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const v = await verifierAppelHub(request, "");
  if (!v.ok) return NextResponse.json({ error: v.reason === "v1_refused" ? "Signature v1 refused (X-Veridian-Sig-Version: 2 required)" : "Invalid signature" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("workspace_id")?.trim();
  if (!id || id.length > 254) return NextResponse.json({ error: "invalid_body", message: "workspace_id requis" }, { status: 400 });
  try {
    return NextResponse.json({ members: await listerAdmins(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return refus(e);
  }
}
