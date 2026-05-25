/**
 * POST /api/tenants/{id}/credit-leads — refill leads (ticket refill 1/3 + 2/3).
 *
 * Réfère : CONTRAT-BILLING.md §8.4 (refill = flux séparé de l'abonnement),
 * PRICING-VERIDIAN.md §95-108 (grille dégressive) + §78 (welcome leads).
 *
 * Reçoit le signal de crédit du Hub — soit après un Stripe Checkout one-shot
 * (`source: "purchase"`), soit à la souscription / l'upgrade d'un plan
 * (`source: "welcome"`, leads offerts). Le Hub est le SEUL interlocuteur
 * Stripe (§2) : cet endpoint ne parle jamais à Stripe et ne reçoit jamais de
 * webhook Stripe — il applique un crédit déjà décidé par le Hub.
 *
 * Auth : HMAC Hub standard (Pattern A, CONTRAT-HUB.md §6.1).
 *
 * Body :
 *   {
 *     "quantity": 5000,                  // > 0
 *     "source": "purchase" | "welcome",
 *     "welcome_plan": "pro",             // REQUIS ssi source='welcome'
 *     "idempotency_key": "uuid-v4",
 *     "stripe_payment_id": "pi_...",     // optionnel, audit
 *     "contract_version": "2.0"
 *   }
 *
 * Comportement :
 *  1. Résout le tenant (UUID ou email owner, cf resolveTenantByIdOrEmail).
 *  2. Workspace par défaut = premier créé (createdAt ASC).
 *  3. Double idempotence :
 *     a. `lead_credit_events.idempotency_key` UNIQUE — un signal rejoué à
 *        l'identique ne crédite qu'une fois (P2002 → 200 no-op).
 *     b. `(workspace_id, welcome_plan)` UNIQUE — un crédit `welcome` est
 *        offert AU PLUS une fois par palier de plan. Deux grants welcome
 *        pour le même palier (clés idempotency différentes : retry buggé,
 *        re-provision) → P2002 → 200 no-op. Le Hub crédite le DELTA entre
 *        paliers (Free→Pro = +1 900) ; ce garde empêche le double-grant si
 *        le Hub se trompe — l'invariant business §8.4 est protégé en DB,
 *        pas seulement par la discipline du caller.
 *  4. Incrémente `leadsCredited` + insère la ligne d'historique dans une
 *     même transaction.
 *  5. Audit log `tenant.leads_credited`.
 *
 * Fail-safe : ce endpoint ne DÉCRÉMENTE jamais (c'est un crédit). Le
 * décompte (`leadsConsumed`) vit dans GET /api/leads/[domain].
 *
 * Erreurs :
 *  - 401 HMAC invalide
 *  - 404 `tenant_not_found`
 *  - 400 `invalid_payload` — quantity ≤ 0, contract_version major inconnu
 *  - 422 `invalid_body` — body malformé (champ requis manquant / type faux,
 *    welcome sans welcome_plan, purchase avec welcome_plan)
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";
import { logAudit } from "@/lib/audit";

/** Major du contrat billing supporté (aligné sur update-plan / CONTRAT-BILLING v2). */
const SUPPORTED_CONTRACT_MAJOR = 2;

/**
 * Paliers de plan welcome — alignés sur les `PlanId` locaux Prospection
 * (`src/lib/billing/plans.ts`). Le Hub envoie l'enum canonique `free|pro|
 * business|enterprise` ; il DOIT le mapper vers le nom local avant d'appeler
 * cet endpoint (cohérent avec ce que persiste update-plan). On valide ici
 * l'enum LOCAL — pas l'enum canonique du fil.
 */
const WELCOME_PLANS = ["freemium", "pro", "business"] as const;

/**
 * Schéma du body. `quantity` doit être un entier strictement positif :
 * un crédit ≤ 0 n'a pas de sens (et un négatif décrémenterait — interdit).
 *
 * `welcome_plan` est lié à `source` :
 *  - source='welcome' → welcome_plan REQUIS (sinon on ne sait pas pour quel
 *    palier le grant est offert → l'anti-double-grant ne pourrait pas opérer).
 *  - source='purchase' → welcome_plan INTERDIT (un achat n'a pas de palier).
 * Le `superRefine` impose ce couplage.
 */
const CreditLeadsSchema = z
  .object({
    quantity: z.number().int().positive(),
    source: z.enum(["purchase", "welcome"]),
    welcome_plan: z.enum(WELCOME_PLANS).optional(),
    idempotency_key: z.string().uuid(),
    stripe_payment_id: z.string().max(255).optional(),
    contract_version: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.source === "welcome" && !data.welcome_plan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["welcome_plan"],
        message: "welcome_plan is required when source='welcome'",
      });
    }
    if (data.source === "purchase" && data.welcome_plan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["welcome_plan"],
        message: "welcome_plan must be omitted when source='purchase'",
      });
    }
  });

/** Extrait le major d'une string de version (`"2.0"` → `2`, `"2"` → `2`). */
function parseMajor(version: string): number | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  // ── Validation du body (§ erreurs : 422 body malformé) ───────────────────
  const parsed = CreditLeadsSchema.safeParse(auth.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 422 },
    );
  }
  const body = parsed.data;
  // welcome_plan persisté UNIQUEMENT pour un crédit welcome (NULL pour purchase
  // — un achat n'a pas de palier ; le superRefine garantit déjà ce couplage).
  const welcomePlan = body.source === "welcome" ? body.welcome_plan! : null;

  // ── Versioning — major inconnu = breaking change explicite, jamais deviné ─
  const major = parseMajor(body.contract_version);
  if (major !== SUPPORTED_CONTRACT_MAJOR) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: `unsupported contract_version major (got "${body.contract_version}", expected ${SUPPORTED_CONTRACT_MAJOR}.x)`,
        details: { supported_major: SUPPORTED_CONTRACT_MAJOR },
      },
      { status: 400 },
    );
  }

  // ── Résolution du tenant (UUID local OU email owner — Hub legacy) ─────────
  const { id: tenantIdParam } = await ctx.params;
  const tenant = await resolveTenantByIdOrEmail(tenantIdParam);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  const tenantId = tenant.id;

  // ── Workspace par défaut = premier créé. Le quota refill vit au niveau
  //    workspace (le provisioning crée 1 workspace par tenant). ───────────────
  const workspace = await prisma.workspace.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, leadsCredited: true, leadsConsumed: true },
  });
  if (!workspace) {
    // Tenant sans workspace : provisioning incomplet. On ne crée pas de
    // workspace ici (ce n'est pas le rôle d'un endpoint de crédit) — on
    // remonte l'anomalie pour que le Hub la traite.
    return NextResponse.json(
      {
        error: "tenant_not_found",
        message: "tenant has no active workspace to credit",
      },
      { status: 404 },
    );
  }

  // ── Crédit idempotent ─────────────────────────────────────────────────────
  // Deux gardes uniques en DB :
  //  - `idempotency_key` UNIQUE → replay du même signal.
  //  - `(workspace_id, welcome_plan)` UNIQUE → double-grant welcome par palier.
  // Crédit + insert de l'historique dans une transaction : soit les deux,
  // soit aucun (jamais un solde incrémenté sans trace, ni l'inverse).
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.leadCreditEvent.create({
        data: {
          workspaceId: workspace.id,
          tenantId,
          quantity: body.quantity,
          source: body.source,
          welcomePlan,
          idempotencyKey: body.idempotency_key,
          stripePaymentId: body.stripe_payment_id ?? null,
          contractVersion: body.contract_version,
        },
      });
      return tx.workspace.update({
        where: { id: workspace.id },
        data: { leadsCredited: { increment: body.quantity } },
        select: { leadsCredited: true, leadsConsumed: true },
      });
    });

    const balance = updated.leadsCredited - updated.leadsConsumed;

    await logAudit({
      tenantId,
      actorId: null,
      actorType: "hub",
      action: "tenant.leads_credited",
      targetType: "workspace",
      targetId: workspace.id,
      metadata: {
        quantity: body.quantity,
        source: body.source,
        welcome_plan: welcomePlan,
        idempotency_key: body.idempotency_key,
        stripe_payment_id: body.stripe_payment_id ?? null,
        balance,
        contract_version: body.contract_version,
      },
    });

    console.log(
      `[credit-leads] tenant=${tenantId} workspace=${workspace.id} ` +
        `+${body.quantity} (${body.source}${welcomePlan ? `:${welcomePlan}` : ""}) ` +
        `balance=${balance} key=${body.idempotency_key}`,
    );

    return NextResponse.json({ credited: body.quantity, balance });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // P2002 — soit un replay du même `idempotency_key`, soit un second
      // grant welcome pour un palier déjà crédité. Les deux cas sont des
      // no-op idempotents : le crédit a déjà été appliqué une fois.
      const target = (err.meta?.target as string[] | string | undefined) ?? "";
      const isWelcomeDuplicate =
        Array.isArray(target)
          ? target.includes("welcome_plan")
          : String(target).includes("welcome_plan");

      const current = await prisma.workspace.findUnique({
        where: { id: workspace.id },
        select: { leadsCredited: true, leadsConsumed: true },
      });
      const balance = current
        ? current.leadsCredited - current.leadsConsumed
        : workspace.leadsCredited - workspace.leadsConsumed;

      console.log(
        `[credit-leads] tenant=${tenantId} ${
          isWelcomeDuplicate
            ? `welcome_plan=${welcomePlan} already granted`
            : `idempotency_key=${body.idempotency_key} replay`
        } — no-op`,
      );
      return NextResponse.json({
        // Sur un double-grant welcome, rien n'a été crédité cette fois-ci :
        // on renvoie credited=0 pour ne pas laisser croire au Hub que le
        // delta a été ajouté. Sur un replay strict, credited reflète la
        // quantité du signal d'origine (déjà appliquée).
        credited: isWelcomeDuplicate ? 0 : body.quantity,
        balance,
        idempotent_replay: true,
      });
    }
    throw err;
  }
}
