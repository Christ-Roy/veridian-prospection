/**
 * /leads/buy — page native refill ICP (différenciateur produit Veridian
 * vs Apollo/Cognism/Lusha qui vendent du brute).
 *
 * Server component fin : auth gate + résolution plan tenant → délègue au
 * client `RefillIcpClient` qui gère tout le state + l'orchestration.
 *
 * Décision Robert (cf ticket §1) : l'user reste dans Prosp pendant TOUTE
 * la configuration ICP. Le seul saut hors-app est la page Stripe Checkout
 * hébergée par Stripe (inévitable, et un user qui paie en direct sur Stripe
 * voit bien que c'est Stripe = trust ↑).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth-config";
import { prisma } from "@/lib/prisma";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { RefillIcpClient } from "@/components/billing/refill-icp/RefillIcpClient";

export const dynamic = "force-dynamic";

function mapTenantPlanToRefillTier(plan: string | null | undefined): PlanId {
  switch (plan) {
    case "pro":
      return "pro";
    case "business":
    case "enterprise":
    case "lifetime_site_vitrine":
    case "lifetime_partner":
    case "internal":
      return "business";
    case "freemium":
    case "starter":
    case "geo":
    case "full":
    default:
      return "freemium";
  }
}

export default async function RefillIcpPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/leads/buy");
  }

  // Résoud tenant du user (direct ownership puis fallback membership).
  let tenant = await prisma.tenant.findFirst({
    where: { userId: session.user.id, deletedAt: null },
    select: { id: true, plan: true },
  });
  if (!tenant) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
      include: { workspace: true },
    });
    if (membership?.workspace?.tenantId) {
      tenant = await prisma.tenant.findUnique({
        where: { id: membership.workspace.tenantId },
        select: { id: true, plan: true },
      });
    }
  }
  if (!tenant) {
    redirect("/login?next=/leads/buy");
  }

  const tier = mapTenantPlanToRefillTier(tenant.plan);
  const planLabel = PLANS[tier]?.label ?? tier;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href="/settings/leads"
        className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3 w-3" />
        Retour à mes leads
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Acheter des leads ciblés
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
          Configurez votre profil ICP et achetez un lot de leads
          correspondants. Les leads achetés sont ajoutés à votre workspace
          de manière permanente. Plan actuel :{" "}
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {planLabel}
          </span>
          .
        </p>
      </header>

      <RefillIcpClient initialTier={tier} planLabel={planLabel} />
    </div>
  );
}
