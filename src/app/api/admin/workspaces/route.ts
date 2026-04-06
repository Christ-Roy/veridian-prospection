/**
 * Admin API — Workspaces
 * Cf. roadmap/09-workspaces-multi-user.md
 *
 * GET   /api/admin/workspaces          → list workspaces in tenant
 * POST  /api/admin/workspaces          → create workspace { name, slug? }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, invalidateAllUserContexts } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const workspaces = await prisma.workspace.findMany({
    where: { tenantId: auth.ctx.tenantId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json(
    workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      createdAt: w.createdAt,
      memberCount: w._count.members,
    }))
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name: string = (body?.name || "").trim();
  const explicitSlug: string | undefined = body?.slug?.trim();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let slug = explicitSlug || slugify(name);
  if (!slug) slug = "workspace";

  // Ensure uniqueness within tenant — append -2, -3, etc. if collision
  let finalSlug = slug;
  let i = 2;
  while (
    await prisma.workspace.findFirst({
      where: { tenantId: auth.ctx.tenantId, slug: finalSlug },
    })
  ) {
    finalSlug = `${slug}-${i++}`;
    if (i > 100) break;
  }

  const workspace = await prisma.workspace.create({
    data: {
      tenantId: auth.ctx.tenantId,
      name,
      slug: finalSlug,
      createdBy: auth.ctx.userId,
    },
  });

  invalidateAllUserContexts();

  return NextResponse.json(
    {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: workspace.createdAt,
      memberCount: 0,
    },
    { status: 201 }
  );
}
