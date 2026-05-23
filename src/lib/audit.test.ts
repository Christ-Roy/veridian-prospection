/**
 * Tests unitaires pour src/lib/audit.ts
 *
 * Helper qui logue les actions sensibles dans `audit_log` (Prisma).
 * Contrat critique :
 *   - Le helper ne DOIT JAMAIS throw (audit fail ≠ business fail)
 *   - La row insérée DOIT contenir actorType + action (immutable côté DB)
 *   - Les défauts null sont normalisés (tenantId, actorId, targetType, targetId)
 *   - metadata vide → {} (Prisma Json non-null)
 *   - Table inexistante (P2021) → branche silencieuse, pas d'erreur propagée
 *
 * Note : le module audit garde un flag `auditTableMissingWarned` au niveau
 * module pour ne warner qu'une fois. Pour tester les branches "table missing"
 * de manière isolée, on utilise `vi.resetModules()` + re-import.
 *
 * Run: npx vitest run src/lib/audit.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockAuditLogCreate } = vi.hoisted(() => ({
  mockAuditLogCreate: vi.fn(),
}));

vi.mock("./prisma", () => ({
  prisma: {
    auditLog: { create: mockAuditLogCreate },
  },
}));

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockAuditLogCreate.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/**
 * Charge une instance fraîche du module audit (reset le flag warned interne).
 */
async function loadFreshAudit() {
  vi.resetModules();
  const mod = await import("./audit");
  return mod;
}

describe("logAudit — happy path", () => {
  it("appelle prisma.auditLog.create avec le payload exact (workspace.created)", async () => {
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate.mockResolvedValueOnce({ id: "log-1" });

    await logAudit({
      tenantId: "tenant-42",
      actorId: "user-7",
      actorType: "user",
      action: "workspace.created",
      targetType: "workspace",
      targetId: "ws-100",
      metadata: { name: "Team Sales" },
    });

    expect(mockAuditLogCreate).toHaveBeenCalledOnce();
    const call = mockAuditLogCreate.mock.calls[0][0];
    expect(call).toEqual({
      data: {
        tenantId: "tenant-42",
        actorId: "user-7",
        actorType: "user",
        action: "workspace.created",
        targetType: "workspace",
        targetId: "ws-100",
        metadata: { name: "Team Sales" },
      },
    });
  });

  it("normalise les optionnels à null + metadata vide à {}", async () => {
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate.mockResolvedValueOnce({ id: "log-2" });

    await logAudit({
      actorType: "system",
      action: "tenant.provisioned",
    });

    const call = mockAuditLogCreate.mock.calls[0][0];
    expect(call.data.tenantId).toBeNull();
    expect(call.data.actorId).toBeNull();
    expect(call.data.targetType).toBeNull();
    expect(call.data.targetId).toBeNull();
    expect(call.data.metadata).toEqual({});
    expect(call.data.actorType).toBe("system");
    expect(call.data.action).toBe("tenant.provisioned");
  });

  it("accepte une action string libre (custom Prospection)", async () => {
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate.mockResolvedValueOnce({ id: "log-3" });

    await logAudit({
      actorType: "user",
      action: "lead.exported",
      tenantId: "t-1",
    });

    expect(mockAuditLogCreate.mock.calls[0][0].data.action).toBe("lead.exported");
  });
});

describe("logAudit — fail-safe : ne casse JAMAIS le flow métier", () => {
  it("ne throw pas si la table n'existe pas (P2021) et warn une seule fois", async () => {
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate
      .mockRejectedValueOnce(
        Object.assign(new Error('relation "audit_log" does not exist'), {
          code: "P2021",
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('relation "audit_log" does not exist'), {
          code: "P2021",
        }),
      );

    // Premier appel : on s'attend à un warn + pas de throw.
    await expect(
      logAudit({ actorType: "user", action: "workspace.deleted" }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Deuxième appel : flag interne empêche le re-warn (anti-spam logs).
    await expect(
      logAudit({ actorType: "user", action: "workspace.deleted" }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Pas d'error generic : c'est le branche "table missing" attendu.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ne throw pas sur une erreur Prisma quelconque (DB down) et logge sur error", async () => {
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      logAudit({ actorType: "user", action: "auth.failed_login" }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    // Pas le warn "table missing" — c'est une vraie erreur infra.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("ne throw pas sur un type d'erreur non-Error (string brute)", async () => {
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate.mockRejectedValueOnce("string-error");

    await expect(
      logAudit({ actorType: "system", action: "tenant.suspended" }),
    ).resolves.toBeUndefined();
  });
});

describe("logAudit — détection 'table missing' par sous-string", () => {
  it.each([
    ['relation "audit_log" does not exist'],
    ["P2021: The table `public.audit_log` does not exist"],
    ["relation does not exist for migration"],
  ])("matche le pattern 'table missing' pour: %s", async (msg) => {
    // Reset le module pour repartir d'un flag `warned=false` propre.
    const { logAudit } = await loadFreshAudit();
    mockAuditLogCreate.mockRejectedValueOnce(new Error(msg));

    await logAudit({ actorType: "user", action: "workspace.updated" });

    // Ces cas DOIVENT déclencher le warn de migration, pas l'error generic.
    // Si ce test rougit, le branch fail-safe est cassé → on va loguer des
    // erreurs partout en prod avant la migration P1.7.
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
