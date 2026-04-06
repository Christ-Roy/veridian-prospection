/**
 * seed-fake-team.ts — Seed 3 fake team members + pipeline data for
 * validating the /admin/members page (visibility scope, pipeline drawer, history).
 *
 * Usage (dev staging, depuis ~/prospection-dashboard-dev) :
 *   npx tsx scripts/seed-fake-team.ts
 *   npx tsx scripts/seed-fake-team.ts --reset   # cleanup avant re-seed
 *
 * Ce script :
 *   1) Crée 3 users Supabase (member-1/2/3@test.veridian.site) via admin API,
 *      mot de passe temporaire, email auto-confirmé.
 *   2) Les ajoute à workspace_members du workspace de Robert
 *      (tenant_id + workspace lus depuis la DB — pas de hardcode fragile).
 *      Un des membres est réglé sur visibility_scope='own', les deux autres 'all'.
 *   3) Pour chaque member, crée 10-20 outreach / 5 call_log / 5 claude_activity
 *      sur des SIREN aléatoires de `entreprises` avec prospect_score > 40.
 *      Tous les rows portent tenant_id + workspace_id + user_id.
 *
 * Idempotent : cherche les users par email avant de les créer ; les rows
 * attachées à ces user_id sont effacées si --reset.
 *
 * Requiert :
 *   DATABASE_URL                       (prospection staging DB)
 *   SUPABASE_URL                       (staging Supabase)
 *   SUPABASE_SERVICE_ROLE_KEY          (staging service role)
 *
 * Cible par défaut : le tenant propriétaire de robert.brunon@veridian.site.
 * Override via ROBERT_EMAIL=... pour cibler un autre owner.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const RESET = process.argv.includes("--reset");

const FAKE_MEMBERS = [
  {
    email: "member-1@test.veridian.site",
    name: "Alice (test)",
    scope: "all" as const,
  },
  {
    email: "member-2@test.veridian.site",
    name: "Bob (test)",
    scope: "own" as const,
  },
  {
    email: "member-3@test.veridian.site",
    name: "Chloé (test)",
    scope: "own" as const,
  },
];

const PIPELINE_STATUSES = [
  "a_contacter",
  "contacte",
  "appele",
  "interesse",
  "rdv",
  "rappeler",
  "relancer",
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function isoNow(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86400_000).toISOString();
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const prisma = new PrismaClient();

  // 1) Resolve Robert's tenant + workspace
  console.log(`[seed] resolving tenant for ${ROBERT_EMAIL}`);
  const { data: ownerUser } = await supabase
    .from("tenants")
    .select("id, user_id")
    .limit(1000);
  let tenantId: string | null = null;
  let ownerId: string | null = null;

  if (ownerUser && ownerUser.length > 0) {
    // Find which tenant belongs to ROBERT_EMAIL
    const { data: users } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });
    const robert = users?.users?.find(
      (u) => (u.email ?? "").toLowerCase() === ROBERT_EMAIL.toLowerCase()
    );
    if (!robert) throw new Error(`No Supabase user for ${ROBERT_EMAIL}`);
    ownerId = robert.id;
    const t = ownerUser.find((row) => row.user_id === robert.id);
    if (!t) throw new Error(`No tenant row for ${ROBERT_EMAIL} (user ${robert.id})`);
    tenantId = t.id;
  }
  if (!tenantId || !ownerId) throw new Error("Tenant resolution failed");

  const workspace = await prisma.workspace.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true },
  });
  if (!workspace) throw new Error(`No workspace in tenant ${tenantId}`);
  console.log(`[seed] tenant=${tenantId} workspace=${workspace.id} (${workspace.name})`);
  console.log(`[seed] owner=${ownerId}`);

  // 2) Create/resolve fake Supabase users
  const { data: allUsersData } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  const existingByEmail = new Map<string, string>();
  for (const u of allUsersData?.users ?? []) {
    if (u.email) existingByEmail.set(u.email.toLowerCase(), u.id);
  }

  const memberIds: Record<string, string> = {};
  for (const m of FAKE_MEMBERS) {
    let userId = existingByEmail.get(m.email.toLowerCase());
    if (!userId) {
      console.log(`[seed] creating Supabase user ${m.email}`);
      const { data, error } = await supabase.auth.admin.createUser({
        email: m.email,
        password: `Fake-${Date.now()}-!ABC`,
        email_confirm: true,
        user_metadata: { name: m.name, seeded: true },
      });
      if (error || !data.user) throw new Error(`createUser ${m.email}: ${error?.message}`);
      userId = data.user.id;
    } else {
      console.log(`[seed] existing Supabase user ${m.email} = ${userId}`);
    }
    memberIds[m.email] = userId;
  }

  // 3) Reset if requested
  if (RESET) {
    const ids = Object.values(memberIds);
    console.log(`[seed] --reset → deleting rows for ${ids.length} fake members`);
    await prisma.outreach.deleteMany({
      where: { tenantId, userId: { in: ids } },
    });
    await prisma.callLog.deleteMany({
      where: { tenantId, userId: { in: ids } },
    });
    await prisma.claudeActivity.deleteMany({
      where: { tenantId, userId: { in: ids } },
    });
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: workspace.id, userId: { in: ids } },
    });
  }

  // 4) Upsert workspace memberships
  for (const m of FAKE_MEMBERS) {
    const userId = memberIds[m.email]!;
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: { role: "member", visibilityScope: m.scope },
      create: {
        workspaceId: workspace.id,
        userId,
        role: "member",
        visibilityScope: m.scope,
      },
    });
    console.log(`[seed] membership OK ${m.email} scope=${m.scope}`);
  }

  // 5) Pick random siren pool
  const sirenPool = await prisma.$queryRaw<Array<{ siren: string }>>`
    SELECT siren FROM entreprises
    WHERE prospect_score >= 40 AND COALESCE(is_registrar, false) = false
      AND COALESCE(ca_suspect, false) = false
    ORDER BY random()
    LIMIT 200
  `;
  if (sirenPool.length < 50) {
    throw new Error(`Siren pool too small (${sirenPool.length}), tune query`);
  }
  console.log(`[seed] siren pool size: ${sirenPool.length}`);

  // 6) For each fake member, seed outreach + call_log + claude_activity
  for (const m of FAKE_MEMBERS) {
    const userId = memberIds[m.email]!;
    const outreachCount = 10 + Math.floor(Math.random() * 11); // 10-20
    const usedSirens = new Set<string>();

    for (let i = 0; i < outreachCount; i++) {
      // pick unique siren
      let siren: string;
      do {
        siren = randomChoice(sirenPool).siren;
      } while (usedSirens.has(siren));
      usedSirens.add(siren);

      await prisma.outreach.upsert({
        where: { siren_tenantId: { siren, tenantId } },
        update: {
          workspaceId: workspace.id,
          userId,
          status: randomChoice(PIPELINE_STATUSES),
          updatedAt: isoNow(Math.floor(Math.random() * 10)),
        },
        create: {
          siren,
          tenantId,
          workspaceId: workspace.id,
          userId,
          status: randomChoice(PIPELINE_STATUSES),
          notes: `Seeded for ${m.email}`,
          updatedAt: isoNow(Math.floor(Math.random() * 10)),
          position: i,
        },
      });
    }

    // call logs
    for (let i = 0; i < 5; i++) {
      const siren = randomChoice([...usedSirens]);
      await prisma.callLog.create({
        data: {
          tenantId,
          workspaceId: workspace.id,
          userId,
          siren,
          direction: "outbound",
          provider: "telnyx",
          status: Math.random() > 0.5 ? "completed" : "no_answer",
          startedAt: isoNow(Math.floor(Math.random() * 10)),
          durationSeconds: Math.floor(Math.random() * 300),
          notes: `Test call ${i + 1} by ${m.name}`,
        },
      });
    }

    // claude activity (notes)
    for (let i = 0; i < 5; i++) {
      const siren = randomChoice([...usedSirens]);
      await prisma.claudeActivity.create({
        data: {
          tenantId,
          workspaceId: workspace.id,
          userId,
          siren,
          activityType: "note",
          title: `Note ${i + 1}`,
          content: `Fake note by ${m.name} for validation of admin-members drawer.`,
          createdAt: isoNow(Math.floor(Math.random() * 10)),
        },
      });
    }

    console.log(
      `[seed] ${m.email}: ${outreachCount} outreach, 5 calls, 5 claude_activity`
    );
  }

  console.log("[seed] done.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[seed] ERROR", err);
  process.exit(1);
});
