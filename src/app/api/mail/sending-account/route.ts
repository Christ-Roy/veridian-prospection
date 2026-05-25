/**
 * /api/mail/sending-account — GET (state) + POST (toggle).
 *
 * Pilote le mail provider du workspace actif :
 *   GET  → état courant (provider, email, connected_at) — member-level OK
 *   POST → toggle provider ('gmail-via-hub' ou 'none') — admin only
 *
 * L'OAuth Gmail lui-même est porté par le Hub (cf vision §4
 * veridian-hub/todo/2026-05-25-mail-gateway-hub-multi-provider.md).
 * Prosp ne stocke que le state "ce workspace utilise cette voie d'envoi" +
 * la timestamp du toggle pour l'audit.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireAdmin } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = ["none", "gmail-via-hub"] as const;
type ValidProvider = (typeof VALID_PROVIDERS)[number];

const toggleSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
});

export async function GET() {
  const result = await requireUser();
  if ("error" in result) return result.error;
  const ctx = result.ctx;

  const workspaceId = ctx.activeWorkspaceId ?? ctx.workspaces[0]?.id;
  if (!workspaceId) {
    return NextResponse.json(
      { error: "No workspace", reason: "no_workspace" },
      { status: 404 },
    );
  }

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      mailProvider: true,
      gmailConnectedAt: true,
      gmailQuotaPerDay: true,
    },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({
    provider: ws.mailProvider as ValidProvider,
    email: ctx.email,
    gmailConnectedAt: ws.gmailConnectedAt?.toISOString() ?? null,
    gmailQuotaPerDay: ws.gmailQuotaPerDay,
    isAdmin: ctx.isAdmin,
  });
}

export async function POST(request: NextRequest) {
  const adminCheck = await requireAdmin();
  if ("error" in adminCheck) return adminCheck.error;
  const ctx = adminCheck.ctx;

  const workspaceId = ctx.activeWorkspaceId ?? ctx.workspaces[0]?.id;
  if (!workspaceId) {
    return NextResponse.json(
      { error: "No workspace", reason: "no_workspace" },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const { provider } = parsed.data;

  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      mailProvider: provider,
      gmailConnectedAt: provider === "gmail-via-hub" ? new Date() : null,
    },
    select: {
      mailProvider: true,
      gmailConnectedAt: true,
    },
  });

  await logAudit({
    tenantId: ctx.tenantId,
    actorType: "user",
    actorId: ctx.userId,
    action: "mail.provider.changed",
    targetType: "workspace",
    targetId: workspaceId,
    metadata: { provider },
  });

  return NextResponse.json({
    ok: true,
    provider: updated.mailProvider as ValidProvider,
    gmailConnectedAt: updated.gmailConnectedAt?.toISOString() ?? null,
  });
}
