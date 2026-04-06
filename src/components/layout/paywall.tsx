"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, CreditCard, Check, Zap, Crown, Rocket } from "lucide-react";
import { useTrial } from "@/lib/trial-context";

interface PaywallProps {
  open: boolean;
  onClose: () => void;
}

const plans = [
  {
    id: "trial_extended",
    name: "Essai etendu",
    price: "0€",
    priceYearly: "0€",
    period: "30 jours",
    description: "Continuez gratuitement en ajoutant une carte bancaire",
    icon: CreditCard,
    color: "border-blue-200 bg-blue-50/50",
    badge: null,
    features: [
      "300 prospects visibles",
      "Pipeline Kanban",
      "Historique des fiches",
      "Filtres avances",
    ],
    cta: "Ajouter ma carte",
    ctaVariant: "outline" as const,
  },
  {
    id: "pro",
    name: "Pro",
    price: "29€",
    priceYearly: "24€",
    period: "/mois",
    description: "Pour les commerciaux independants et petites equipes",
    icon: Zap,
    color: "border-indigo-300 bg-indigo-50/50 ring-2 ring-indigo-200",
    badge: "Recommande",
    features: [
      "100 000 prospects",
      "Pipeline Kanban",
      "Filtres avances + export",
      "Historique illimite",
      "Telephonie SIP (bientot)",
      "Analyse IA (bientot)",
    ],
    cta: "Choisir Pro",
    ctaVariant: "default" as const,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "49€",
    priceYearly: "41€",
    period: "/mois",
    description: "Pour les equipes de vente structurees",
    icon: Crown,
    color: "border-amber-200 bg-amber-50/50",
    badge: null,
    features: [
      "500 000 prospects",
      "Tout le plan Pro",
      "Multi-utilisateurs",
      "API access",
      "Support prioritaire",
      "Donnees financieres",
    ],
    cta: "Choisir Enterprise",
    ctaVariant: "outline" as const,
  },
];

export function Paywall({ open, onClose }: PaywallProps) {
  const { daysLeft } = useTrial();
  const [loading, setLoading] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  if (!open) return null;

  function handleSelect(planId: string) {
    setLoading(planId);
    const hubUrl = process.env.NEXT_PUBLIC_HUB_URL || "";
    if (planId === "trial_extended") {
      window.location.href = `${hubUrl}/dashboard/billing?action=extend_trial`;
    } else {
      const appUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      window.location.href = `${hubUrl}/pricing?plan=${planId}&interval=${billingInterval}&redirect=${encodeURIComponent(appUrl + "/prospects?checkout=success")}`;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl mx-4 animate-in slide-in-from-bottom-4 duration-300">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 h-8 w-8 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <Card className="p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium mb-4">
              <Rocket className="h-3.5 w-3.5" />
              {daysLeft > 0
                ? `Plus que ${daysLeft} jour${daysLeft > 1 ? "s" : ""} d'essai`
                : "Votre essai gratuit est termine"}
            </div>
            <h2 className="text-2xl font-bold">Passez a la vitesse superieure</h2>
            <p className="text-muted-foreground mt-2">
              Debloquez l&apos;acces complet a vos prospects et outils de prospection
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                size="sm"
                variant={billingInterval === "monthly" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setBillingInterval("monthly")}
              >
                Mensuel
              </Button>
              <Button
                size="sm"
                variant={billingInterval === "yearly" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setBillingInterval("yearly")}
              >
                Annuel <span className="ml-1 text-[10px] text-green-600">-17%</span>
              </Button>
            </div>
          </div>

          {/* Plans */}
          <div className="grid grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-xl border p-5 flex flex-col ${plan.color} transition-shadow hover:shadow-md`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <plan.icon className="h-5 w-5" />
                    <span className="font-semibold">{plan.name}</span>
                  </div>
                  {plan.badge && (
                    <Badge className="bg-indigo-600 text-white text-[10px]">{plan.badge}</Badge>
                  )}
                </div>
                <div className="mb-2">
                  <span className="text-2xl font-bold">{billingInterval === "yearly" && plan.priceYearly ? plan.priceYearly : plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">{plan.description}</p>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <Check className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={plan.ctaVariant}
                  className="w-full"
                  onClick={() => handleSelect(plan.id)}
                  disabled={loading !== null}
                >
                  {loading === plan.id ? "Redirection..." : plan.cta}
                </Button>
              </div>
            ))}
          </div>

          <p className="text-center text-[11px] text-muted-foreground mt-6">
            Paiement securise par Stripe. Annulation possible a tout moment.
          </p>
        </Card>
      </div>
    </div>
  );
}
