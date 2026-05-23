/**
 * Unit tests for src/lib/invitations.ts (Auth.js v5 — Supabase migration).
 *
 * Prisma + bcrypt mockés. Aucun appel réseau ni DB réelle.
 * Run: npx vitest run src/lib/invitations.test.ts
 *
 * Réécrit 2026-05-23 suite au passage de Supabase Auth (GoTrue mort) vers
 * Auth.js v5 + Prisma + bcrypt. L'ancien fichier mockait fetch Supabase
 * et le retour `session.access_token` — tout ça est remplacé par les calls
 * Prisma `user.upsert`/`account.upsert` + bcrypt.hash.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockQueryRawUnsafe,
  mockExecuteRawUnsafe,
  mockUserUpsert,
  mockAccountUpsert,
  mockTenantFindUnique,
  mockUserFindUnique,
  mockWorkspaceFindUnique,
  mockSendInvitationEmail,
} = vi.hoisted(() => ({
  mockQueryRawUnsafe: vi.fn(),
  mockExecuteRawUnsafe: vi.fn(),
  mockUserUpsert: vi.fn(),
  mockAccountUpsert: vi.fn(),
  mockTenantFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    $executeRawUnsafe: mockExecuteRawUnsafe,
    user: { upsert: mockUserUpsert, findUnique: mockUserFindUnique },
    account: { upsert: mockAccountUpsert },
    tenant: { findUnique: mockTenantFindUnique },
    workspace: { findUnique: mockWorkspaceFindUnique },
  },
}));

vi.mock("@/lib/notifuse/client", () => ({
  sendInvitationEmail: mockSendInvitationEmail,
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async (pwd: string) => `bcrypt:${pwd}`) },
}));

import {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  revokeInvitation,
  listInvitationsByTenant,
} from "./invitations";

beforeEach(() => {
  mockQueryRawUnsafe.mockReset();
  mockExecuteRawUnsafe.mockReset();
  mockUserUpsert.mockReset();
  mockAccountUpsert.mockReset();
  mockTenantFindUnique.mockReset();
  mockUserFindUnique.mockReset();
  mockWorkspaceFindUnique.mockReset();
  mockSendInvitationEmail.mockReset();
  process.env.APP_URL = "https://app.test.local";
  // Par défaut : tenant non provisionné Notifuse → emailSent=false silent.
  // Les tests qui veulent emailSent=true overrident ce mock.
  mockTenantFindUnique.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue(null);
  mockWorkspaceFindUnique.mockResolvedValue(null);
});

// ──────────────────────────────────────────────────────────────────────────
//  createInvitation
// ──────────────────────────────────────────────────────────────────────────
describe("createInvitation", () => {
  it("génère un token 64-hex, lowercase l'email, persiste la row, retourne emailSent=false", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 42 }]);

    const result = await createInvitation({
      email: "Alice@Example.com",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      workspaceId: "33333333-3333-3333-3333-333333333333",
      role: "member",
    });

    expect(result.id).toBe(42);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inviteUrl).toBe(`https://app.test.local/invite/${result.token}`);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Le mail n'est plus envoyé par Supabase — emailSent toujours false tant
    // que Notifuse n'est pas branché (TODO documenté).
    expect(result.emailSent).toBe(false);

    const [, email, invitedBy, tenantId, workspaceId, role] = mockQueryRawUnsafe.mock.calls[0];
    expect(email).toBe("alice@example.com");
    expect(invitedBy).toBe("11111111-1111-1111-1111-111111111111");
    expect(tenantId).toBe("22222222-2222-2222-2222-222222222222");
    expect(workspaceId).toBe("33333333-3333-3333-3333-333333333333");
    expect(role).toBe("member");
  });

  it("refuse un email invalide", async () => {
    await expect(
      createInvitation({
        email: "not-an-email",
        invitedBy: "11111111-1111-1111-1111-111111111111",
        tenantId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(/invalid email/);
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("normalise le rôle inconnu vers 'member'", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 1 }]);
    await createInvitation({
      email: "x@y.test",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      role: "rogue" as never,
    });
    const role = mockQueryRawUnsafe.mock.calls[0][5];
    expect(role).toBe("member");
  });

  it("ne touche AUCUNE API Supabase (gotrue mort)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 1 }]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await createInvitation({
      email: "x@y.test",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
    });
    // sendInvitationEmail est mocké donc fetch ne devrait JAMAIS être appelé
    // depuis ce test (les credentials Notifuse sont absents en defaults).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ─── Notifuse best-effort ───────────────────────────────────────────────
  it("appelle Notifuse avec workspace_id + apiKey du tenant + vars Liquid", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 99 }]);
    mockTenantFindUnique.mockResolvedValueOnce({
      notifuseWorkspaceSlug: "veridian-prosp-ws-99",
      notifuseApiKey: "jwt.fake.apikey",
      name: "Acme Corp",
    });
    mockUserFindUnique.mockResolvedValueOnce({ email: "boss@acme.com" });
    mockWorkspaceFindUnique.mockResolvedValueOnce({ name: "Team Sales" });
    mockSendInvitationEmail.mockResolvedValueOnce({
      ok: true,
      messageId: "msg-abc",
    });

    const result = await createInvitation({
      email: "newbie@acme.com",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      workspaceId: "33333333-3333-3333-3333-333333333333",
      role: "member",
    });

    expect(result.emailSent).toBe(true);
    expect(mockSendInvitationEmail).toHaveBeenCalledOnce();
    const call = mockSendInvitationEmail.mock.calls[0][0];
    expect(call.workspaceId).toBe("veridian-prosp-ws-99");
    expect(call.apiKey).toBe("jwt.fake.apikey");
    expect(call.toEmail).toBe("newbie@acme.com");
    expect(call.vars.inviter_email).toBe("boss@acme.com");
    expect(call.vars.workspace_name).toBe("Team Sales");
    expect(call.vars.invite_url).toMatch(/^https:\/\/app\.test\.local\/invite\/[0-9a-f]{64}$/);
    expect(call.vars.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(call.externalId).toMatch(/^invitation-[0-9a-f]{16}$/);
  });

  it("emailSent=false si le tenant n'a pas de notifuseApiKey (pas provisionné)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 100 }]);
    mockTenantFindUnique.mockResolvedValueOnce({
      notifuseWorkspaceSlug: null,
      notifuseApiKey: null,
      name: "Pending Corp",
    });

    const result = await createInvitation({
      email: "x@pending.test",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
    });

    expect(result.emailSent).toBe(false);
    expect(mockSendInvitationEmail).not.toHaveBeenCalled();
    // L'invitation EST créée (id renvoyé, inviteUrl utilisable) — l'admin
    // copie-colle. Notifuse non-bloquant.
    expect(result.id).toBe(100);
    expect(result.inviteUrl).toMatch(/^https:\/\/app\.test\.local\/invite\//);
  });

  it("emailSent=false si Notifuse répond ok=false (template absent, 503, etc.) — invitation préservée", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 101 }]);
    mockTenantFindUnique.mockResolvedValueOnce({
      notifuseWorkspaceSlug: "ws-101",
      notifuseApiKey: "apikey",
      name: "T",
    });
    mockUserFindUnique.mockResolvedValueOnce({ email: "boss@t.test" });
    mockSendInvitationEmail.mockResolvedValueOnce({
      ok: false,
      reason: "missing_template",
      status: 400,
    });

    const result = await createInvitation({
      email: "x@t.test",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
    });

    expect(result.emailSent).toBe(false);
    expect(result.id).toBe(101);
    expect(mockSendInvitationEmail).toHaveBeenCalledOnce();
  });

  it("emailSent=false si sendInvitationEmail throw inopinément — invitation préservée (jamais bloquant)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 102 }]);
    mockTenantFindUnique.mockResolvedValueOnce({
      notifuseWorkspaceSlug: "ws-102",
      notifuseApiKey: "apikey",
      name: "T",
    });
    mockUserFindUnique.mockResolvedValueOnce({ email: "boss@t.test" });
    mockSendInvitationEmail.mockRejectedValueOnce(new Error("bug inattendu"));

    const result = await createInvitation({
      email: "x@t.test",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
    });

    expect(result.emailSent).toBe(false);
    expect(result.id).toBe(102);
  });

  it("workspace_name fallback sur tenant.name si invitation tenant-level (workspaceId null)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 103 }]);
    mockTenantFindUnique.mockResolvedValueOnce({
      notifuseWorkspaceSlug: "ws-103",
      notifuseApiKey: "apikey",
      name: "Tenant Name Fallback",
    });
    mockUserFindUnique.mockResolvedValueOnce({ email: "boss@t.test" });
    mockSendInvitationEmail.mockResolvedValueOnce({ ok: true });

    await createInvitation({
      email: "x@t.test",
      invitedBy: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      // pas de workspaceId
    });

    expect(mockWorkspaceFindUnique).not.toHaveBeenCalled();
    const call = mockSendInvitationEmail.mock.calls[0][0];
    expect(call.vars.workspace_name).toBe("Tenant Name Fallback");
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getInvitationByToken
// ──────────────────────────────────────────────────────────────────────────
describe("getInvitationByToken", () => {
  it("retourne la row si pending non expirée", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([
      {
        id: 1,
        email: "x@y.test",
        token: "abc",
        workspace_id: "33333333-3333-3333-3333-333333333333",
        role: "admin",
      },
    ]);
    const row = await getInvitationByToken("abc");
    expect(row).not.toBeNull();
    expect(row?.email).toBe("x@y.test");
  });

  it("retourne null pour un token vide", async () => {
    const row = await getInvitationByToken("");
    expect(row).toBeNull();
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("retourne null si aucune row matchée", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    const row = await getInvitationByToken("inexistant");
    expect(row).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  acceptInvitation — coeur de la migration Auth.js v5
// ──────────────────────────────────────────────────────────────────────────
describe("acceptInvitation", () => {
  const VALID_INVITE = {
    id: 7,
    email: "newbie@example.com",
    invited_by: "11111111-1111-1111-1111-111111111111",
    tenant_id: "22222222-2222-2222-2222-222222222222",
    workspace_id: "33333333-3333-3333-3333-333333333333",
    role: "member" as const,
    token: "tok123",
    expires_at: new Date(Date.now() + 86400000),
    accepted_at: null,
    revoked_at: null,
    created_at: new Date(),
  };

  it("crée User + Account(credentials, bcrypt) + WorkspaceMember + mark accepted", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    mockUserUpsert.mockResolvedValueOnce({ id: "user-uuid-new" });
    mockAccountUpsert.mockResolvedValueOnce({ id: "acc-uuid" });
    mockExecuteRawUnsafe.mockResolvedValueOnce(1); // workspace_members
    mockExecuteRawUnsafe.mockResolvedValueOnce(1); // UPDATE invitations

    const result = await acceptInvitation({
      token: "tok123",
      password: "secret12345",
      fullName: "New Bie",
    });

    expect(result).toEqual({
      userId: "user-uuid-new",
      email: "newbie@example.com",
      redirectTo: "/prospects",
    });

    expect(mockUserUpsert).toHaveBeenCalledOnce();
    const userCall = mockUserUpsert.mock.calls[0][0];
    expect(userCall.where).toEqual({ email: "newbie@example.com" });
    expect(userCall.create.email).toBe("newbie@example.com");
    expect(userCall.create.name).toBe("New Bie");
    expect(userCall.create.emailVerified).toBeInstanceOf(Date);

    expect(mockAccountUpsert).toHaveBeenCalledOnce();
    const accCall = mockAccountUpsert.mock.calls[0][0];
    expect(accCall.where).toEqual({
      provider_providerAccountId: {
        provider: "credentials",
        providerAccountId: "newbie@example.com",
      },
    });
    expect(accCall.create.access_token).toBe("bcrypt:secret12345");
    expect(accCall.create.provider).toBe("credentials");
    expect(accCall.update.access_token).toBe("bcrypt:secret12345");

    expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(2);
    expect(mockExecuteRawUnsafe.mock.calls[0][1]).toBe(VALID_INVITE.workspace_id);
    expect(mockExecuteRawUnsafe.mock.calls[0][2]).toBe("user-uuid-new");
    expect(mockExecuteRawUnsafe.mock.calls[1][0]).toContain("UPDATE invitations");
  });

  it("ne touche AUCUNE API Supabase et ne retourne PAS de session", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    mockUserUpsert.mockResolvedValueOnce({ id: "u" });
    mockAccountUpsert.mockResolvedValueOnce({ id: "a" });
    mockExecuteRawUnsafe.mockResolvedValue(1);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await acceptInvitation({
      token: "tok123",
      password: "secret12345",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("session");
  });

  it("refuse un password < 8 caractères", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    await expect(
      acceptInvitation({ token: "tok123", password: "short" }),
    ).rejects.toThrow(/at least 8/);
    expect(mockUserUpsert).not.toHaveBeenCalled();
  });

  it("rejette si l'invitation est introuvable ou expirée", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    await expect(
      acceptInvitation({ token: "expired", password: "validpass1" }),
    ).rejects.toThrow(/invalid or expired/);
    expect(mockUserUpsert).not.toHaveBeenCalled();
  });

  it("idempotent : un User déjà existant est mis à jour (upsert update branch)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    mockUserUpsert.mockResolvedValueOnce({ id: "existing-user-uuid" });
    mockAccountUpsert.mockResolvedValueOnce({ id: "a" });
    mockExecuteRawUnsafe.mockResolvedValue(1);

    const result = await acceptInvitation({
      token: "tok123",
      password: "newPassword99",
    });

    expect(result.userId).toBe("existing-user-uuid");
    expect(mockAccountUpsert.mock.calls[0][0].update.access_token).toBe("bcrypt:newPassword99");
  });

  it("skippe le upsert WorkspaceMember si invitation sans workspace_id", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ ...VALID_INVITE, workspace_id: null }]);
    mockUserUpsert.mockResolvedValueOnce({ id: "u" });
    mockAccountUpsert.mockResolvedValueOnce({ id: "a" });
    mockExecuteRawUnsafe.mockResolvedValueOnce(1);

    await acceptInvitation({ token: "tok123", password: "secret12345" });

    expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockExecuteRawUnsafe.mock.calls[0][0]).toContain("UPDATE invitations");
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  revokeInvitation + listInvitationsByTenant
// ──────────────────────────────────────────────────────────────────────────
describe("revokeInvitation", () => {
  it("update revoked_at sur la row matchée par (id, tenantId)", async () => {
    mockExecuteRawUnsafe.mockResolvedValueOnce(1);
    await revokeInvitation(7, "22222222-2222-2222-2222-222222222222");
    expect(mockExecuteRawUnsafe).toHaveBeenCalledOnce();
    expect(mockExecuteRawUnsafe.mock.calls[0][0]).toContain("UPDATE invitations");
    expect(mockExecuteRawUnsafe.mock.calls[0][0]).toContain("revoked_at = now()");
  });
});

describe("listInvitationsByTenant", () => {
  it("liste les invitations pending par défaut", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const rows = await listInvitationsByTenant("22222222-2222-2222-2222-222222222222");
    expect(rows).toHaveLength(2);
    expect(mockQueryRawUnsafe.mock.calls[0][0]).toContain(
      "AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
    );
  });

  it("supporte le filtre status=accepted", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    await listInvitationsByTenant("22222222-2222-2222-2222-222222222222", {
      status: "accepted",
    });
    expect(mockQueryRawUnsafe.mock.calls[0][0]).toContain("AND accepted_at IS NOT NULL");
  });
});
