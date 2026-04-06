/**
 * Admin API — Invites (magic links)
 *
 * POST /api/admin/invites
 *   body: { email, workspaceId, role? }
 *   → generates an internal token stored in magic_links table
 *   → returns { inviteUrl, token, expiresAt }
 *     (admin copies the URL and sends it manually via whatever channel)
 *
 * GET /api/admin/invites
 *   → list pending invites (not yet used, not expired)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function getBaseUrl(request: NextRequest) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    new URL(request.url).origin
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const email: string = (body?.email || "").trim().toLowerCase();
  const workspaceId: string | undefined = body?.workspaceId;
  const role: "admin" | "member" = body?.role === "admin" ? "admin" : "member";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "valid email is required" }, { status: 400 });
  }
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify the workspace belongs to this tenant
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, tenantId: auth.ctx.tenantId },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Generate a url-safe random token
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Use raw SQL since magic_links is not yet in the Prisma schema
  await prisma.$executeRaw`
    INSERT INTO magic_links (token, email, tenant_id, workspace_id, role, invited_by, expires_at)
    VALUES (${token}, ${email}, ${auth.ctx.tenantId}::uuid, ${workspaceId}::uuid, ${role}, ${auth.ctx.userId}::uuid, ${expiresAt})
  `;

  const inviteUrl = `${getBaseUrl(request)}/invite/${token}`;

  return NextResponse.json(
    {
      inviteUrl,
      token,
      email,
      workspaceId,
      workspaceName: ws.name,
      role,
      expiresAt: expiresAt.toISOString(),
    },
    { status: 201 }
  );
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rows = await prisma.$queryRaw<
    Array<{
      token: string;
      email: string;
      workspace_id: string;
      role: string;
      expires_at: Date;
      used_at: Date | null;
      created_at: Date;
    }>
  >`
    SELECT token, email, workspace_id, role, expires_at, used_at, created_at
    FROM magic_links
    WHERE tenant_id = ${auth.ctx.tenantId}::uuid
      AND used_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;

  return NextResponse.json({
    invites: rows.map((r) => ({
      token: r.token,
      email: r.email,
      workspaceId: r.workspace_id,
      role: r.role,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
  });
}
