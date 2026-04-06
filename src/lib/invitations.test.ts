/**
 * Unit tests for src/lib/invitations.ts.
 *
 * Prisma + global fetch are mocked. No real DB or Supabase is touched.
 * Run: npx vitest run src/lib/invitations.test.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { mockQueryRawUnsafe, mockExecuteRawUnsafe } = vi.hoisted(() => ({
  mockQueryRawUnsafe: vi.fn(),
  mockExecuteRawUnsafe: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    $executeRawUnsafe: mockExecuteRawUnsafe,
  },
}));

// Import AFTER mocks are installed
import {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  revokeInvitation,
} from "./invitations";

// Helper: fake Response
function ok(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockQueryRawUnsafe.mockReset();
  mockExecuteRawUnsafe.mockReset();
  vi.restoreAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    APP_URL: "https://app.test.local",
    SUPABASE_URL: "https://supa.test.local",
    NEXT_PUBLIC_SUPABASE_URL: "https://supa.test.local",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  };
  delete process.env.SUPABASE_SMTP_CONFIGURED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createInvitation", () => {
  it("generates a unique 64-hex-char token and builds the invite URL from APP_URL", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 42 }]);
    // generateLink call
    const fetchMock = vi.fn().mockResolvedValue(ok({ action_link: "https://…" }));
    vi.stubGlobal("fetch", fetchMock);

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
    expect(result.emailSent).toBe(true);

    // Prisma received a lowercased email and the role
    const [, email, invitedBy, tenantId, workspaceId, role] = mockQueryRawUnsafe.mock.calls[0];
    expect(email).toBe("alice@example.com");
    expect(invitedBy).toBe("11111111-1111-1111-1111-111111111111");
    expect(tenantId).toBe("22222222-2222-2222-2222-222222222222");
    expect(workspaceId).toBe("33333333-3333-3333-3333-333333333333");
    expect(role).toBe("member");

    // Supabase generateLink was hit with type:invite
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/v1/admin/generate_link");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.type).toBe("invite");
    expect(body.email).toBe("alice@example.com");
    expect(body.options.redirect_to).toBe(result.inviteUrl);
  });

  it("returns emailSent:false when generateLink throws (SMTP down) but still persists the row", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 7 }]);
    const fetchMock = vi.fn().mockRejectedValue(new Error("SMTP unreachable"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createInvitation({
      email: "bob@example.com",
      invitedBy: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      role: "admin",
    });

    expect(result.id).toBe(7);
    expect(result.emailSent).toBe(false);
    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
  });

  it("skips generateLink entirely when SUPABASE_SMTP_CONFIGURED=false", async () => {
    process.env.SUPABASE_SMTP_CONFIGURED = "false";
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 99 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createInvitation({
      email: "carol@example.com",
      invitedBy: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
    });

    expect(result.emailSent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getInvitationByToken", () => {
  it("filters accepted/revoked/expired via SQL and returns the row when valid", async () => {
    const row = {
      id: 1,
      email: "a@b.c",
      invited_by: "u",
      tenant_id: "t",
      workspace_id: null,
      role: "member",
      token: "tok",
      expires_at: new Date(Date.now() + 1000),
      accepted_at: null,
      revoked_at: null,
      created_at: new Date(),
    };
    mockQueryRawUnsafe.mockResolvedValueOnce([row]);

    const out = await getInvitationByToken("tok");
    expect(out).toEqual(row);

    const [sql, tokenParam] = mockQueryRawUnsafe.mock.calls[0];
    expect(String(sql)).toContain("accepted_at IS NULL");
    expect(String(sql)).toContain("revoked_at IS NULL");
    expect(String(sql)).toContain("expires_at > now()");
    expect(tokenParam).toBe("tok");
  });

  it("returns null when the token is empty (no DB call)", async () => {
    const out = await getInvitationByToken("");
    expect(out).toBeNull();
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("returns null when no row matches", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    const out = await getInvitationByToken("nope");
    expect(out).toBeNull();
  });
});

describe("acceptInvitation", () => {
  const VALID_INVITE = {
    id: 10,
    email: "new.user@example.com",
    invited_by: "inv-uuid",
    tenant_id: "tenant-uuid",
    workspace_id: "ws-uuid",
    role: "member" as const,
    token: "tok123",
    expires_at: new Date(Date.now() + 1000),
    accepted_at: null,
    revoked_at: null,
    created_at: new Date(),
  };

  it("creates a new Supabase user when none exists, upserts workspace_members, signs in, and marks accepted", async () => {
    // getInvitationByToken
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    mockExecuteRawUnsafe.mockResolvedValue(1);

    const fetchMock = vi.fn()
      // list users → empty
      .mockResolvedValueOnce(ok({ users: [] }))
      // create user
      .mockResolvedValueOnce(ok({ id: "new-user-uuid", email: VALID_INVITE.email }))
      // tenants lookup → empty
      .mockResolvedValueOnce(ok([]))
      // tenants insert
      .mockResolvedValueOnce(ok({}, 201))
      // signin
      .mockResolvedValueOnce(
        ok({ access_token: "AT", refresh_token: "RT", token_type: "bearer", expires_in: 3600 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await acceptInvitation({
      token: "tok123",
      password: "password123",
      fullName: "New User",
    });

    expect(out.userId).toBe("new-user-uuid");
    expect(out.redirectTo).toBe("/prospects");
    expect(out.session.access_token).toBe("AT");

    // create user was called with email_confirm:true
    const createCall = fetchMock.mock.calls[1];
    const createBody = JSON.parse((createCall[1] as RequestInit).body as string);
    expect(createBody.email).toBe(VALID_INVITE.email);
    expect(createBody.password).toBe("password123");
    expect(createBody.email_confirm).toBe(true);
    expect(createBody.user_metadata.full_name).toBe("New User");

    // workspace_members upsert
    const upsertCall = mockExecuteRawUnsafe.mock.calls.find((c) =>
      String(c[0]).includes("workspace_members"),
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toBe("ws-uuid");
    expect(upsertCall![2]).toBe("new-user-uuid");
    expect(upsertCall![3]).toBe("member");

    // invitation marked accepted
    const acceptCall = mockExecuteRawUnsafe.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE invitations SET accepted_at"),
    );
    expect(acceptCall).toBeDefined();
    expect(acceptCall![1]).toBe(10);
  });

  it("updates the password when a Supabase user already exists", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    mockExecuteRawUnsafe.mockResolvedValue(1);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        ok({ users: [{ id: "existing-uuid", email: VALID_INVITE.email }] }),
      )
      // update user
      .mockResolvedValueOnce(ok({ id: "existing-uuid" }))
      // tenants lookup → already mapped
      .mockResolvedValueOnce(ok([{ id: "tenant-uuid" }]))
      // signin
      .mockResolvedValueOnce(
        ok({ access_token: "AT2", refresh_token: "RT2", token_type: "bearer" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await acceptInvitation({ token: "tok123", password: "password123" });

    expect(out.userId).toBe("existing-uuid");
    // second fetch is a PUT to /admin/users/existing-uuid
    const putCall = fetchMock.mock.calls[1];
    expect(String(putCall[0])).toContain("/auth/v1/admin/users/existing-uuid");
    expect((putCall[1] as RequestInit).method).toBe("PUT");
  });

  it("throws when the invitation is invalid or expired", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]); // getInvitationByToken → null
    await expect(
      acceptInvitation({ token: "bad", password: "password123" }),
    ).rejects.toThrow("invalid or expired");
  });

  it("throws when the password is too short", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([VALID_INVITE]);
    await expect(
      acceptInvitation({ token: "tok123", password: "short" }),
    ).rejects.toThrow("at least 8 characters");
  });
});

describe("revokeInvitation", () => {
  it("sets revoked_at scoped by tenant_id", async () => {
    mockExecuteRawUnsafe.mockResolvedValueOnce(1);
    await revokeInvitation(123, "tenant-uuid");

    expect(mockExecuteRawUnsafe).toHaveBeenCalledOnce();
    const [sql, id, tenantId] = mockExecuteRawUnsafe.mock.calls[0];
    expect(String(sql)).toContain("UPDATE invitations");
    expect(String(sql)).toContain("SET revoked_at = now()");
    expect(String(sql)).toContain("tenant_id = $2::uuid");
    expect(id).toBe(123);
    expect(tenantId).toBe("tenant-uuid");
  });
});
