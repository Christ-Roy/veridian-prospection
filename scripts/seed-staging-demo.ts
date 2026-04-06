/**
 * Seed staging demo data for workspace/multi-user feature testing.
 *
 * Creates in the target tenant (robert@veridian.site):
 *  - 3 workspaces: Paris, Lyon, Marseille
 *  - 3 Supabase users as "commerciaux" assigned to each workspace
 *  - Robert added as admin on all 3 workspaces
 *  - Varied outreach rows (statuses: a_contacter, en_cours, gagne, perdu)
 *  - A few followups and call_logs for KPI testing
 *
 * Idempotent: safe to re-run.
 *
 * Usage (from dev server):
 *   cd ~/prospection-dev
 *   npx tsx scripts/seed-staging-demo.ts
 *
 * Or from local (with staging DB URL):
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx dashboard/scripts/seed-staging-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

const TENANT_OWNER_EMAIL = "robert@veridian.site";
const DEMO_SALES = [
  { email: "sales-paris@demo.veridian.site", city: "Paris" },
  { email: "sales-lyon@demo.veridian.site", city: "Lyon" },
  { email: "sales-marseille@demo.veridian.site", city: "Marseille" },
];

const prisma = new PrismaClient();

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required");
  return createSupabaseAdmin(url, key);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateUser(admin: any, email: string): Promise<string> {
  // Paginate auth users, find by email
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const existing = data?.users.find((u: { id: string; email?: string }) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !created?.user) throw new Error(`Failed to create user ${email}: ${error?.message}`);
  return created.user.id;
}

async function main() {
  console.log("=== Seeding staging demo data ===\n");

  const admin = getSupabaseAdmin();

  // 1) Find the tenant owner (robert)
  const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  const ownerUser = listData?.users.find(
    (u) => u.email?.toLowerCase() === TENANT_OWNER_EMAIL.toLowerCase()
  );
  if (!ownerUser) throw new Error(`Owner user ${TENANT_OWNER_EMAIL} not found in Supabase`);
  console.log(`✓ Owner user: ${ownerUser.email} (${ownerUser.id})`);

  // 2) Find the tenant row for this user
  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .select("id, slug")
    .eq("user_id", ownerUser.id)
    .maybeSingle();
  if (tenantErr || !tenantRow) throw new Error(`Tenant not found for ${TENANT_OWNER_EMAIL}: ${tenantErr?.message}`);
  const tenantId: string = tenantRow.id;
  console.log(`✓ Tenant: ${tenantRow.slug} (${tenantId})\n`);

  // 3) Create 3 workspaces (Paris, Lyon, Marseille) — idempotent
  const workspaces: { id: string; name: string; slug: string }[] = [];
  for (const demo of DEMO_SALES) {
    const slug = demo.city.toLowerCase();
    let ws = await prisma.workspace.findFirst({
      where: { tenantId, slug },
    });
    if (!ws) {
      ws = await prisma.workspace.create({
        data: {
          tenantId,
          name: demo.city,
          slug,
          createdBy: ownerUser.id,
        },
      });
      console.log(`  + Created workspace: ${ws.name}`);
    } else {
      console.log(`  = Workspace exists: ${ws.name}`);
    }
    workspaces.push({ id: ws.id, name: ws.name, slug: ws.slug });
  }

  // 4) Robert as admin on all 3 workspaces
  for (const ws of workspaces) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: ownerUser.id } },
      update: { role: "admin" },
      create: { workspaceId: ws.id, userId: ownerUser.id, role: "admin" },
    });
  }
  console.log(`  + Robert added as admin on all 3 workspaces\n`);

  // 5) Create 3 demo sales users and assign them to their workspace
  for (let i = 0; i < DEMO_SALES.length; i++) {
    const demo = DEMO_SALES[i];
    const ws = workspaces[i];
    const userId = await findOrCreateUser(admin, demo.email);
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: ws.id, userId } },
      update: { role: "member" },
      create: { workspaceId: ws.id, userId, role: "member" },
    });
    console.log(`  + ${demo.email} → ${demo.city} (member)`);
  }

  // 6) Populate outreach data — clone 20 existing rows from the internal tenant,
  //    dispatch them across the 3 workspaces with varied statuses
  const STATUSES = ["a_contacter", "en_cours", "gagne", "perdu", "rappel"];
  const sourceRows = await prisma.outreach.findMany({
    where: { tenantId: "00000000-0000-0000-0000-000000000000" },
    take: 30,
  });

  console.log(`\n  Found ${sourceRows.length} source outreach rows to clone\n`);

  let cloned = 0;
  for (let i = 0; i < sourceRows.length; i++) {
    const src = sourceRows[i];
    const targetWs = workspaces[i % workspaces.length];
    const targetStatus = STATUSES[i % STATUSES.length];

    // Check if we already cloned (siren + tenantId unique, post-SIREN refactor)
    const existing = await prisma.outreach.findUnique({
      where: { siren_tenantId: { siren: src.siren, tenantId } },
    });
    if (existing) continue;

    await prisma.outreach.create({
      data: {
        siren: src.siren,
        tenantId,
        workspaceId: targetWs.id,
        status: targetStatus,
        notes: `Seeded demo — ${targetWs.name}`,
        contactedDate: new Date().toISOString(),
      },
    });
    cloned++;
  }
  console.log(`  + Cloned ${cloned} outreach rows across workspaces\n`);

  // 7) Add a few followups
  const outreachInTenant = await prisma.outreach.findMany({
    where: { tenantId, workspaceId: { in: workspaces.map((w) => w.id) } },
    take: 9,
  });
  let followupsCreated = 0;
  for (const o of outreachInTenant.slice(0, 9)) {
    // Check if we already have a followup for this siren
    const existing = await prisma.followup.findFirst({
      where: { tenantId, siren: o.siren },
    });
    if (existing) continue;

    await prisma.followup.create({
      data: {
        tenantId,
        workspaceId: o.workspaceId,
        siren: o.siren,
        scheduledAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        status: followupsCreated % 2 === 0 ? "pending" : "done",
        note: "Demo followup",
      },
    });
    followupsCreated++;
  }
  console.log(`  + Created ${followupsCreated} followups\n`);

  // 8) Add a few call_log entries
  let callsCreated = 0;
  for (const o of outreachInTenant.slice(0, 12)) {
    // Check for duplicates by siren + workspace
    const existing = await prisma.callLog.findFirst({
      where: { tenantId, workspaceId: o.workspaceId, siren: o.siren },
    });
    if (existing) continue;

    await prisma.callLog.create({
      data: {
        tenantId,
        workspaceId: o.workspaceId,
        direction: "outbound",
        provider: "telnyx",
        siren: o.siren,
        status: "ended",
        startedAt: new Date(Date.now() - Math.random() * 7 * 86400_000).toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: Math.floor(60 + Math.random() * 300),
      },
    });
    callsCreated++;
  }
  console.log(`  + Created ${callsCreated} call_log entries\n`);

  // 9) Summary
  const finalCount = {
    workspaces: await prisma.workspace.count({ where: { tenantId } }),
    members: await prisma.workspaceMember.count({
      where: { workspace: { tenantId } },
    }),
    outreach: await prisma.outreach.count({ where: { tenantId } }),
    followups: await prisma.followup.count({ where: { tenantId } }),
    calls: await prisma.callLog.count({ where: { tenantId } }),
  };
  console.log("=== Final state for tenant ===");
  console.log(finalCount);
  console.log("\n✓ Seed complete");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
