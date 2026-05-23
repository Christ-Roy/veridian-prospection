/**
 * GET /api/users/by-email?email=<email>
 *
 * Pattern Hub Discovery : le Hub interroge à la volée chaque app downstream
 * pour savoir si un user y a un workspace. Permet d'éviter la table
 * `hub_app.tenants` dénormalisée côté Hub (cf
 * `veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md`).
 *
 * Auth : HMAC Hub contrat §6.1. Pour GET le `rawBody` signé est la chaîne
 * vide. Le Hub doit donc signer `${timestamp}.` (timestamp + point + body vide).
 *
 * Idempotent, cacheable côté Hub avec TTL 5 min.
 *
 * Réponses :
 *   200 { found: true,  user_email, workspaces: [...] }
 *   200 { found: false }                          (user connu nulle part)
 *   400 { error: "missing_email" | "invalid_email" }
 *   401 { error: "Unauthorized" | "Invalid signature" | "Timestamp expired or invalid" }
 *   500 { error: "Server misconfigured" }
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyHubHmac, verifyLegacyBearer } from "@/lib/hub/hmac";
import { prisma } from "@/lib/prisma";

const ACCEPT_LEGACY_BEARER = process.env.ACCEPT_LEGACY_BEARER !== "0";

function getSecret(): string | undefined {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
}

// Validation email RFC-light (suffisant pour empêcher l'injection,
// strict enough sans bloquer les TLDs longs).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type WorkspaceCard = {
  workspace_id: string;
  workspace_name: string;
  role: string;
  plan: string;
  status: "active" | "suspended" | "deleted";
  magic_link_capable: boolean;
  fallback_url: string;
};

export async function GET(request: NextRequest) {
  // ─── Auth HMAC ────────────────────────────────────────────────────────────
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sig = request.headers.get("x-veridian-hub-signature");
  const ts = Number(request.headers.get("x-veridian-timestamp"));

  if (sig) {
    // Pour GET, rawBody = "" (pas de body envoyé). Le Hub doit signer
    // exactement `${ts}.` (la chaîne avec point final).
    const v = verifyHubHmac(secret, ts, "", sig);
    if (!v.ok) {
      const error =
        v.reason === "timestamp_drift" || v.reason === "invalid_timestamp"
          ? "Timestamp expired or invalid"
          : "Invalid signature";
      return NextResponse.json({ error }, { status: 401 });
    }
  } else if (ACCEPT_LEGACY_BEARER) {
    const v = verifyLegacyBearer(secret, request.headers.get("authorization"));
    if (!v.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Log explicite pour pouvoir flipper ACCEPT_LEGACY_BEARER=0 en confiance
    // après une fenêtre d'observation 7j à 0 occurrence.
    console.warn(
      "[by-email] legacy Bearer accepted — migrate Hub to standard HMAC {ts}.",
    );
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Validation email ─────────────────────────────────────────────────────
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // ─── Query ────────────────────────────────────────────────────────────────
  // User par email (soft-deleted exclu)
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  // Workspaces où l'user est membre (soft-deleted exclus côté workspace ET membership)
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      workspace: { deletedAt: null },
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          tenantId: true,
        },
      },
    },
  });

  if (memberships.length === 0) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  // Tenant lookup batch pour récupérer le plan (1 query au lieu de N)
  const tenantIds = Array.from(new Set(memberships.map((m) => m.workspace.tenantId)));
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds }, deletedAt: null },
    select: { id: true, plan: true, status: true },
  });
  const tenantByID = new Map(tenants.map((t) => [t.id, t]));

  const workspaces: WorkspaceCard[] = memberships
    .map((m): WorkspaceCard | null => {
      const tenant = tenantByID.get(m.workspace.tenantId);
      // tenant absent = soft-deleted (filtré par la query deletedAt: null
      // ci-dessus) → on cache le workspace
      if (!tenant) return null;
      // Aussi cacher les tenants suspendus (Stripe past_due / canceled)
      if (tenant.status === "suspended" || tenant.status === "deleted") return null;
      return {
        workspace_id: m.workspace.id,
        workspace_name: m.workspace.name,
        role: m.role,
        plan: tenant.plan ?? "freemium",
        status: "active",
        // Prospection supporte l'autologin via /api/auth/token (cf
        // src/app/api/tenants/provision/route.ts génération prospection_login_token).
        magic_link_capable: true,
        fallback_url: "https://prospection.app.veridian.site/login",
      };
    })
    .filter((w): w is WorkspaceCard => w !== null);

  if (workspaces.length === 0) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  return NextResponse.json(
    {
      found: true,
      user_email: user.email,
      workspaces,
    },
    { status: 200 },
  );
}
