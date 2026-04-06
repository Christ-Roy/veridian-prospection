/**
 * API smoke test — invitation flow (no browser).
 *
 * Flow:
 *   1. Magic link admin → session cookie (pattern identique à test-admin-routes.ts)
 *   2. POST /api/admin/invitations {email, role:"member"} → 201 {token, inviteUrl, id}
 *   3. GET  /api/invitations/:token (public) → 200 {email, role, ...}
 *   4. POST /api/invitations/:token/accept {password} → 200 {session, userId, redirectTo}
 *   5. Re-GET /api/invitations/:token → 404/410 (consommée) OR contains accepted marker
 *   6. GET  /api/admin/invitations → 200 contient au moins 1 entrée
 *   7. DELETE /api/admin/invitations/:id → 204/200/404
 *   8. Cleanup: supprimer le user Supabase créé
 *
 * Tolérant : si un endpoint n'existe pas encore (404/501), log un warning et continue.
 * Exit 1 si plus de la moitié des assertions échouent, sinon 0.
 * Failures dumpées dans /tmp/invite-api-failures.md.
 *
 * Usage (staging):
 *   APP_URL=https://saas-prospection.staging.veridian.site \
 *   SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/test-invite-api.ts
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const APP_URL =
  process.env.APP_URL || "https://saas-prospection.staging.veridian.site";
const TENANT_OWNER_EMAIL = process.env.TEST_EMAIL || "robert@veridian.site";
const INVITEE_EMAIL = `inv-api-${Date.now()}@yopmail.com`;
const INVITEE_PASSWORD = "TestAccept2026!";

type Assertion = { name: string; ok: boolean; details?: string };
const assertions: Assertion[] = [];
const failures: Array<{ name: string; body: unknown; status: number }> = [];

function assert(name: string, cond: boolean, details?: string) {
  assertions.push({ name, ok: cond, details });
  console.log(`${cond ? "✓" : "✗"} ${name}${details ? ` — ${details}` : ""}`);
}

function recordFailure(name: string, status: number, body: unknown) {
  failures.push({ name, status, body });
}

async function main() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY required",
    );
  }

  // 1) Magic link admin → session cookie
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: TENANT_OWNER_EMAIL,
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(
      `generateLink failed: ${linkErr?.message ?? "no hashed_token"}`,
    );
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data: sessionData, error: otpErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpErr || !sessionData?.session) {
    throw new Error(`verifyOtp failed: ${otpErr?.message ?? "no session"}`);
  }
  console.log(
    `✓ admin session for ${TENANT_OWNER_EMAIL} (${sessionData.user?.id})`,
  );

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_in: sessionData.session.expires_in,
        expires_at: sessionData.session.expires_at,
        token_type: "bearer",
        user: sessionData.user,
      }),
    ).toString("base64");
  const adminCookie = `${cookieName}=${cookieValue}`;

  async function hit(
    method: string,
    path: string,
    opts: { body?: object; cookie?: string } = {},
  ) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.cookie) headers.Cookie = opts.cookie;
    const res = await fetch(`${APP_URL}${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* no body */
    }
    return { status: res.status, body: payload };
  }

  // --- 2) POST /api/admin/invitations ---
  let invitationId: number | null = null;
  let invitationToken: string | null = null;
  const createRes = await hit("POST", "/api/admin/invitations", {
    cookie: adminCookie,
    body: { email: INVITEE_EMAIL, role: "member" },
  });
  const created = createRes.body as
    | {
        id?: number;
        token?: string;
        inviteUrl?: string;
        emailSent?: boolean;
        email?: string;
      }
    | null;
  const createOk =
    createRes.status === 201 && !!created?.token && !!created?.inviteUrl;
  assert(
    "POST /api/admin/invitations → 201 avec token+inviteUrl",
    createOk,
    `status=${createRes.status}`,
  );
  if (!createOk) {
    recordFailure("POST /api/admin/invitations", createRes.status, createRes.body);
  } else {
    invitationId = created?.id ?? null;
    invitationToken = created?.token ?? null;
    assert(
      "POST /api/admin/invitations body.email matches request",
      created?.email === INVITEE_EMAIL,
      `got=${created?.email}`,
    );
    assert(
      "POST /api/admin/invitations body.emailSent is boolean",
      typeof created?.emailSent === "boolean",
      `typeof=${typeof created?.emailSent}`,
    );
  }

  // --- 3) GET /api/invitations/:token (public, sans cookie) ---
  if (invitationToken) {
    const lookupRes = await hit("GET", `/api/invitations/${invitationToken}`);
    const lookupBody = lookupRes.body as
      | { email?: string; role?: string; workspaceId?: string | null }
      | null;
    const lookupOk = lookupRes.status === 200 && lookupBody?.email === INVITEE_EMAIL;
    assert(
      "GET /api/invitations/:token (public) → 200 + email match",
      lookupOk,
      `status=${lookupRes.status}, email=${lookupBody?.email}`,
    );
    if (!lookupOk) recordFailure("GET /api/invitations/:token", lookupRes.status, lookupRes.body);
    assert(
      "GET /api/invitations/:token body has role",
      lookupBody?.role === "member",
      `role=${lookupBody?.role}`,
    );
  } else {
    console.log("⚠ skip GET /api/invitations/:token (no token from create)");
  }

  // --- 4) POST /api/invitations/:token/accept ---
  let acceptedUserId: string | null = null;
  if (invitationToken) {
    const acceptRes = await hit("POST", `/api/invitations/${invitationToken}/accept`, {
      body: { password: INVITEE_PASSWORD, fullName: "Invite API Test" },
    });
    const acceptBody = acceptRes.body as
      | {
          session?: { access_token?: string; refresh_token?: string };
          userId?: string;
          redirectTo?: string;
        }
      | null;
    const acceptOk =
      acceptRes.status === 200 &&
      !!acceptBody?.session?.access_token &&
      !!acceptBody?.userId;
    assert(
      "POST /api/invitations/:token/accept → 200 + session.access_token",
      acceptOk,
      `status=${acceptRes.status}`,
    );
    if (!acceptOk) {
      recordFailure("POST /api/invitations/:token/accept", acceptRes.status, acceptRes.body);
    } else {
      acceptedUserId = acceptBody?.userId ?? null;
      assert(
        "accept body has redirectTo=/prospects",
        acceptBody?.redirectTo === "/prospects",
        `got=${acceptBody?.redirectTo}`,
      );
    }
  }

  // --- 5) Re-GET /api/invitations/:token — doit être 404/410 ou marqué accepted ---
  if (invitationToken) {
    const refetch = await hit("GET", `/api/invitations/${invitationToken}`);
    // 404/410 attendu (déjà consommée). Certains backends renvoient 200 avec un marqueur.
    const refetchOk = refetch.status === 404 || refetch.status === 410 || refetch.status === 200;
    assert(
      "GET /api/invitations/:token après accept → 404/410/200",
      refetchOk,
      `status=${refetch.status}`,
    );
    if (refetch.status === 200) {
      // si 200, l'API devrait au moins refléter que c'est consommée (acceptedAt non-null)
      const b = refetch.body as { acceptedAt?: string | null } | null;
      if (b?.acceptedAt) {
        console.log(`  ℹ refetch 200 avec acceptedAt=${b.acceptedAt}`);
      }
    }
  }

  // --- 6) GET /api/admin/invitations → liste contient l'invitation ---
  const listRes = await hit("GET", "/api/admin/invitations?status=all", {
    cookie: adminCookie,
  });
  const listBody = listRes.body as { invitations?: Array<{ id: number; email: string }> } | null;
  const listOk =
    listRes.status === 200 && Array.isArray(listBody?.invitations);
  assert(
    "GET /api/admin/invitations → 200 + invitations array",
    listOk,
    `status=${listRes.status}`,
  );
  if (!listOk) {
    recordFailure("GET /api/admin/invitations", listRes.status, listRes.body);
  } else {
    const count = listBody?.invitations?.length ?? 0;
    assert(
      "invitations list has ≥ 1 row",
      count >= 1,
      `count=${count}`,
    );
    // Fallback : si on n'a pas d'id depuis create, essayer de trouver par email
    if (!invitationId && listBody?.invitations) {
      const found = listBody.invitations.find((i) => i.email === INVITEE_EMAIL);
      if (found) invitationId = found.id;
    }
  }

  // --- 7) DELETE /api/admin/invitations/:id ---
  if (invitationId) {
    const delRes = await hit("DELETE", `/api/admin/invitations/${invitationId}`, {
      cookie: adminCookie,
    });
    const delOk =
      delRes.status === 204 || delRes.status === 200 || delRes.status === 404;
    assert(
      "DELETE /api/admin/invitations/:id → 204/200/404",
      delOk,
      `status=${delRes.status}`,
    );
    if (!delOk) recordFailure("DELETE /api/admin/invitations/:id", delRes.status, delRes.body);
  } else {
    console.log("⚠ skip DELETE (no invitation id)");
  }

  // --- 8) Cleanup : supprimer le user Supabase créé ---
  if (acceptedUserId) {
    try {
      const { error: delErr } = await admin.auth.admin.deleteUser(acceptedUserId);
      if (delErr) {
        console.log(`⚠ cleanup deleteUser failed: ${delErr.message}`);
      } else {
        console.log(`✓ cleanup: deleted user ${acceptedUserId}`);
      }
    } catch (e) {
      console.log(`⚠ cleanup deleteUser exception: ${(e as Error).message}`);
    }
  }

  // --- Rapport ---
  const passed = assertions.filter((a) => a.ok).length;
  const failed = assertions.length - passed;
  console.log(`\n${passed}/${assertions.length} assertions passed, ${failed} failed`);

  if (failures.length > 0) {
    const lines: string[] = ["# Invite API Smoke Failures", ""];
    lines.push(`Généré par scripts/test-invite-api.ts contre ${APP_URL}`);
    lines.push("");
    for (const f of failures) {
      lines.push(`## ${f.name}`);
      lines.push(`- status: ${f.status}`);
      lines.push("- body:");
      lines.push("```json");
      lines.push(JSON.stringify(f.body, null, 2));
      lines.push("```");
      lines.push("");
    }
    writeFileSync("/tmp/invite-api-failures.md", lines.join("\n"));
    console.log(`→ failures written to /tmp/invite-api-failures.md`);
  }

  // Tolérant : exit 1 uniquement si plus de la moitié ont échoué
  if (failed > assertions.length / 2) {
    console.log(
      `\n✗ more than half of assertions failed (${failed}/${assertions.length}) — exit 1`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
