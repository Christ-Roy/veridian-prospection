/**
 * Audit log helper — Veridian SaaS standard.
 *
 * Loggue les actions sensibles dans la table `audit_log`. Ne jamais casser un
 * flow métier à cause d'un log raté : on catch et on log sur stderr.
 *
 * Voir docs/saas-standards.md §7 pour la charte complète (actions obligatoires,
 * rétention, format metadata).
 */
import { prisma } from "./prisma";

export type AuditActorType = "user" | "hub" | "stripe" | "system";

export type AuditAction =
  // Workspace lifecycle
  | "workspace.created"
  | "workspace.deleted"
  | "workspace.transferred"
  | "workspace.updated"
  // Members
  | "member.invited"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  // Billing
  | "plan.changed"
  | "billing.subscription_updated"
  // Tenant lifecycle (provisioning API)
  | "tenant.provisioned"
  | "tenant.suspended"
  | "tenant.resumed"
  | "tenant.deleted"
  // Sécurité
  | "admin.impersonate"
  | "auth.failed_login"
  // Libre (ex : "lead.exported" custom Prospection) — string libre accepté aussi
  | (string & {});

export type LogAuditArgs = {
  tenantId?: string | null;
  actorId?: string | null;
  actorType: AuditActorType;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Insert une entrée dans `audit_log`. Ne throw jamais — les erreurs sont
 * loggées sur stderr pour éviter de casser le flow métier.
 *
 * Note : la table `audit_log` n'existe pas encore en DB Prospection au moment
 * où ce helper est ajouté (modèle Prisma ajouté dans le schema mais migration
 * prévue en P1.7). Donc le helper est tolérant au "table not found" —
 * l'insert échoue silencieusement, on log un warn une fois, on continue.
 */
let auditTableMissingWarned = false;

export async function logAudit(args: LogAuditArgs): Promise<void> {
  try {
    // prisma.auditLog existe dans le client généré dès que le modèle est
    // présent dans schema.prisma, même si la table n'existe pas encore en DB.
    await prisma.auditLog.create({
      data: {
        tenantId: args.tenantId ?? null,
        actorId: args.actorId ?? null,
        actorType: args.actorType,
        action: args.action,
        targetType: args.targetType ?? null,
        targetId: args.targetId ?? null,
        metadata: (args.metadata ?? {}) as never,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Si la table n'existe pas encore (avant la migration P1.7), on warn
    // une seule fois et on continue silencieusement.
    if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("P2021")) {
      if (!auditTableMissingWarned) {
        console.warn(
          "[audit] audit_log table not yet migrated — log skipped. " +
            "Schedule migration via P1.7 (main agent only)."
        );
        auditTableMissingWarned = true;
      }
      return;
    }
    console.error("[audit] log failed:", msg);
  }
}
