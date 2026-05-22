/**
 * Quota refill leads — solde + décompte (ticket refill 1/3).
 *
 * Réfère : CONTRAT-BILLING.md §8.4, PRICING-VERIDIAN.md §95-108.
 *
 * Le quota vit au niveau workspace :
 *   solde = workspaces.leads_credited - workspaces.leads_consumed
 *
 * - `leads_credited` est incrémenté par POST /api/tenants/{id}/credit-leads.
 * - `leads_consumed` est incrémenté ici par `consumeLead()`, appelé quand
 *   une fiche entreprise est consultée. Idempotent par (workspace, siren) :
 *   reconsulter la même fiche ne re-décompte pas (le client ne paie jamais
 *   2× la même boîte).
 */
import { prisma } from "@/lib/prisma";

export type LeadBalance = {
  credited: number;
  consumed: number;
  balance: number;
};

/**
 * Marque une fiche entreprise comme consommée par un workspace et décompte
 * 1 lead — idempotent.
 *
 * `INSERT ... ON CONFLICT DO NOTHING` sur la PK composite (workspace_id,
 * siren) : la 1re consultation insère une ligne, les suivantes ne font
 * rien. On n'incrémente `leads_consumed` que si une ligne a réellement été
 * insérée (`xmax = 0` → row neuve). Le tout dans une transaction : jamais
 * une ligne `lead_consumption` sans le compteur correspondant, ni l'inverse.
 *
 * @returns `true` si le lead vient d'être décompté (1re consultation),
 *          `false` si déjà consommé (no-op).
 */
export async function consumeLead(
  siren: string,
  tenantId: string | null,
  workspaceId: string | null,
): Promise<boolean> {
  // Sans workspace résolu, pas de quota à décompter : on no-op proprement
  // plutôt que d'écrire sur un workspace fantôme.
  if (!workspaceId) return false;
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";

  return prisma.$transaction(async (tx) => {
    // `xmax = 0` distingue une ligne fraîchement insérée d'une ligne déjà
    // présente (ON CONFLICT DO NOTHING ne RETURNING rien si conflit).
    const inserted = await tx.$queryRaw<Array<{ siren: string }>>`
      INSERT INTO lead_consumption (workspace_id, siren, tenant_id)
      VALUES (${workspaceId}::uuid, ${siren}, ${effectiveTid}::uuid)
      ON CONFLICT (workspace_id, siren) DO NOTHING
      RETURNING siren
    `;
    if (inserted.length === 0) {
      // Déjà consommé — pas de double décompte.
      return false;
    }
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { leadsConsumed: { increment: 1 } },
    });
    return true;
  });
}

/**
 * Solde de leads d'un workspace. Lecture seule — destiné à l'UI (indicateur
 * de solde) et aux endpoints de lecture.
 */
export async function getLeadBalance(
  workspaceId: string | null,
): Promise<LeadBalance> {
  if (!workspaceId) return { credited: 0, consumed: 0, balance: 0 };
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { leadsCredited: true, leadsConsumed: true },
  });
  if (!ws) return { credited: 0, consumed: 0, balance: 0 };
  return {
    credited: ws.leadsCredited,
    consumed: ws.leadsConsumed,
    balance: ws.leadsCredited - ws.leadsConsumed,
  };
}
