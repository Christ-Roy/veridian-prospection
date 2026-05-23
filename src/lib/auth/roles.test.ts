/**
 * Tests unitaires pour src/lib/auth/roles.ts
 *
 * RBAC Veridian — matrice de permissions opposable dans toutes les apps.
 * Toute régression silencieuse ici = élévation de privilèges en prod.
 *
 * Run: npx vitest run src/lib/auth/roles.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  canPerform,
  isWorkspaceRole,
  normalizeRole,
  ROLE_RANK,
  type WorkspaceAction,
  type WorkspaceRole,
} from "./roles";

describe("ROLE_RANK", () => {
  it("respecte la hiérarchie owner > admin > member > viewer", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.member);
    expect(ROLE_RANK.member).toBeGreaterThan(ROLE_RANK.viewer);
  });
});

describe("canPerform — actions OWNER-only (verrouille le SaaS)", () => {
  const ownerActions: WorkspaceAction[] = [
    "workspace.delete",
    "workspace.transfer",
    "billing.manage",
  ];

  it.each(ownerActions)("seul owner peut effectuer %s", (action) => {
    expect(canPerform("owner", action)).toBe(true);
    expect(canPerform("admin", action)).toBe(false);
    expect(canPerform("member", action)).toBe(false);
    expect(canPerform("viewer", action)).toBe(false);
  });
});

describe("canPerform — actions ADMIN-or-above", () => {
  const adminActions: WorkspaceAction[] = [
    "workspace.update",
    "member.invite",
    "member.remove",
    "member.change_role",
    "resource.update.any",
    "resource.delete.any",
  ];

  it.each(adminActions)("owner et admin peuvent %s, pas member/viewer", (action) => {
    expect(canPerform("owner", action)).toBe(true);
    expect(canPerform("admin", action)).toBe(true);
    expect(canPerform("member", action)).toBe(false);
    expect(canPerform("viewer", action)).toBe(false);
  });
});

describe("canPerform — actions MEMBER-or-above", () => {
  const memberActions: WorkspaceAction[] = [
    "resource.create",
    "resource.update.own",
    "resource.delete.own",
  ];

  it.each(memberActions)("owner/admin/member peuvent %s, viewer non", (action) => {
    expect(canPerform("owner", action)).toBe(true);
    expect(canPerform("admin", action)).toBe(true);
    expect(canPerform("member", action)).toBe(true);
    expect(canPerform("viewer", action)).toBe(false);
  });
});

describe("canPerform — resource.read est ouvert à tous", () => {
  it("tous les rôles peuvent lire", () => {
    expect(canPerform("owner", "resource.read")).toBe(true);
    expect(canPerform("admin", "resource.read")).toBe(true);
    expect(canPerform("member", "resource.read")).toBe(true);
    expect(canPerform("viewer", "resource.read")).toBe(true);
  });
});

describe("isWorkspaceRole — type guard", () => {
  it("accepte les 4 rôles canoniques", () => {
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole("admin")).toBe(true);
    expect(isWorkspaceRole("member")).toBe(true);
    expect(isWorkspaceRole("viewer")).toBe(true);
  });

  it("refuse les variantes invalides", () => {
    expect(isWorkspaceRole("OWNER")).toBe(false); // case-sensitive
    expect(isWorkspaceRole("superadmin")).toBe(false);
    expect(isWorkspaceRole("")).toBe(false);
    expect(isWorkspaceRole(null)).toBe(false);
    expect(isWorkspaceRole(undefined)).toBe(false);
    expect(isWorkspaceRole(42)).toBe(false);
    expect(isWorkspaceRole({ role: "admin" })).toBe(false);
  });
});

describe("normalizeRole — fail-safe vers le rôle le plus restrictif", () => {
  it("préserve les rôles canoniques", () => {
    expect(normalizeRole("owner")).toBe<WorkspaceRole>("owner");
    expect(normalizeRole("admin")).toBe<WorkspaceRole>("admin");
    expect(normalizeRole("member")).toBe<WorkspaceRole>("member");
    expect(normalizeRole("viewer")).toBe<WorkspaceRole>("viewer");
  });

  it("retourne 'viewer' (moins de droits) pour null / undefined / valeur inconnue", () => {
    // Contrat de sécurité : on dégrade vers viewer, jamais vers member ou admin.
    // Si ce test rougit, on est sur un fail-OPEN au lieu de fail-CLOSED.
    expect(normalizeRole(null)).toBe<WorkspaceRole>("viewer");
    expect(normalizeRole(undefined)).toBe<WorkspaceRole>("viewer");
    expect(normalizeRole("")).toBe<WorkspaceRole>("viewer");
    expect(normalizeRole("superadmin")).toBe<WorkspaceRole>("viewer");
    expect(normalizeRole("OWNER")).toBe<WorkspaceRole>("viewer");
    expect(normalizeRole("god")).toBe<WorkspaceRole>("viewer");
  });

  it("le rôle dégradé 'viewer' NE PEUT PAS effectuer une action admin", () => {
    // Garde-fou contractuel sur le couplage normalize → canPerform.
    const degraded = normalizeRole("rogue-string-from-db");
    expect(canPerform(degraded, "member.invite")).toBe(false);
    expect(canPerform(degraded, "workspace.delete")).toBe(false);
    expect(canPerform(degraded, "resource.read")).toBe(true);
  });
});
