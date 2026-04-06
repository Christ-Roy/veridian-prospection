"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check, CreditCard, Zap, Crown, MapPin, ArrowRight, ArrowLeft, Rocket,
} from "lucide-react";
import { FranceMap } from "@/components/dashboard/france-map";
import { DEPARTMENT_NAMES } from "@/components/dashboard/france-map-data";

interface OnboardingProps {
  open: boolean;
  onComplete: (config: { plan: string; departments: string[]; sectors: string[] }) => void;
}

const SECTOR_OPTIONS = [
  "BTP", "COMMERCE", "CONSEIL / GESTION", "RESTAURATION", "IMMOBILIER",
  "INDUSTRIE", "SANTÉ", "AUTOMOBILE", "FORMATION / ENSEIGNEMENT",
  "ARCHITECTURE / INGÉNIERIE", "SERVICES AUX ENTREPRISES",
  "BEAUTÉ / BIEN-ÊTRE", "INFORMATIQUE / TECH", "FINANCE / ASSURANCE",
  "TRANSPORT / LOGISTIQUE", "HÉBERGEMENT", "DROIT", "AGRICULTURE",
];

const plans = [
  {
    id: "freemium",
    name: "Decouverte",
    price: "0€",
    period: "7 jours",
    description: "Explorez vos prospects sur votre zone",
    icon: Rocket,
    color: "border-gray-200 bg-white",
    badge: null,
    features: [
      "Acces complet sur 1-3 departements",
      "Pipeline Kanban",
      "Filtres avances",
      "7 jours d'essai",
    ],
    cta: "Commencer gratuitement",
    requireCard: false,
  },
  {
    id: "freemium_extended",
    name: "Decouverte+",
    price: "0€",
    period: "30 jours",
    description: "Plus de temps pour evaluer, carte requise",
    icon: CreditCard,
    color: "border-blue-200 bg-blue-50/50",
    badge: "30 jours",
    features: [
      "Acces complet sur 1-3 departements",
      "Pipeline Kanban",
      "Filtres avances",
      "30 jours d'essai",
      "Aucun prelevement sans upgrade",
    ],
    cta: "Essai 30 jours",
    requireCard: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "29€",
    period: "/mois",
    description: "Toute la France, sans limites",
    icon: Zap,
    color: "border-indigo-300 bg-indigo-50/50 ring-2 ring-indigo-200",
    badge: "Recommande",
    features: [
      "100 000 prospects, toute la France",
      "Pipeline Kanban",
      "Filtres avances + export",
      "Historique illimite",
      "Telephonie SIP (bientot)",
    ],
    cta: "Choisir Pro",
    requireCard: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "49€",
    period: "/mois",
    description: "Pour les equipes de vente",
    icon: Crown,
    color: "border-amber-200 bg-amber-50/50",
    badge: null,
    features: [
      "500 000 prospects",
      "Tout le plan Pro",
      "Multi-utilisateurs",
      "API access",
      "Support prioritaire",
    ],
    cta: "Choisir Enterprise",
    requireCard: true,
  },
];

export function Onboarding({ open, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<"plan" | "geo" | "sector">("plan");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  if (!open) return null;

  const maxDepts = 3;

  function toggleDept(code: string) {
    setSelectedDepts(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code);
      if (prev.length >= maxDepts) return prev;
      return [...prev, code];
    });
  }

  function handlePlanSelect(planId: string) {
    setSelectedPlan(planId);
    if (planId === "freemium" || planId === "freemium_extended") {
      setStep("geo");
    } else {
      // Paid plans: redirect to checkout, no geo restriction
      const hubUrl = process.env.NEXT_PUBLIC_HUB_URL || "";
      window.location.href = `${hubUrl}/pricing?plan=${planId}`;
    }
  }

  function handleGeoComplete() {
    if (selectedDepts.length === 0) return;
    setStep("sector");
  }

  function handleSectorComplete() {
    if (selectedSectors.length === 0) return;
    onComplete({ plan: selectedPlan!, departments: selectedDepts, sectors: selectedSectors });
  }

  function toggleSector(s: string) {
    setSelectedSectors(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : prev.length >= 5 ? prev : [...prev, s]
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl mx-4 animate-in slide-in-from-bottom-4 duration-300">
        <Card className="p-8 shadow-2xl max-h-[90vh] overflow-y-auto">

          {step === "plan" && (
            <>
              <div className="text-center mb-8">
                <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
                  <span className="text-white font-bold text-xl">V</span>
                </div>
                <h2 className="text-2xl font-bold">Bienvenue sur Veridian Prospection</h2>
                <p className="text-muted-foreground mt-2">
                  +300 000 prospects qualifies, prets a etre contactes. Choisissez votre plan.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-3">
                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    className={`rounded-xl border p-4 flex flex-col cursor-pointer transition-all hover:shadow-md ${plan.color}`}
                    onClick={() => handlePlanSelect(plan.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <plan.icon className="h-5 w-5" />
                      {plan.badge && (
                        <Badge className="bg-indigo-600 text-white text-[10px]">{plan.badge}</Badge>
                      )}
                    </div>
                    <span className="font-semibold text-sm">{plan.name}</span>
                    <div className="my-2">
                      <span className="text-xl font-bold">{plan.price}</span>
                      <span className="text-xs text-muted-foreground">{plan.period}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-3">{plan.description}</p>
                    <ul className="space-y-1.5 mb-4 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-[11px]">
                          <Check className="h-3 w-3 text-green-600 shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant={plan.id === "pro" ? "default" : "outline"}
                      className="w-full text-xs"
                    >
                      {plan.cta}
                      {plan.requireCard && <CreditCard className="h-3 w-3 ml-1" />}
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === "geo" && (
            <>
              <div className="text-center mb-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium mb-3">
                  <MapPin className="h-3.5 w-3.5" />
                  {selectedPlan === "freemium_extended" ? "Essai 30 jours" : "Essai 7 jours"}
                </div>
                <h2 className="text-xl font-bold">Choisissez votre zone de prospection</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Cliquez sur {maxDepts} departements maximum. Tous les prospects de cette zone seront accessibles.
                </p>
                {selectedDepts.length > 0 && (
                  <div className="flex items-center justify-center gap-1.5 mt-3 flex-wrap">
                    {selectedDepts.map(code => (
                      <Badge
                        key={code}
                        variant="secondary"
                        className="cursor-pointer hover:bg-red-100 hover:text-red-700 transition-colors"
                        onClick={() => toggleDept(code)}
                      >
                        {code} — {DEPARTMENT_NAMES[code] || code}
                        <span className="ml-1 text-[10px]">x</span>
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground ml-2">
                      {selectedDepts.length}/{maxDepts}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-center">
                <div className="w-[500px]">
                  <FranceMap
                    selected={selectedDepts}
                    onSelect={(depts) => {
                      // Limit to maxDepts
                      if (depts.length <= maxDepts) {
                        setSelectedDepts(depts);
                      }
                    }}
                    counts={{}}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <Button variant="ghost" size="sm" onClick={() => setStep("plan")} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Retour
                </Button>
                <Button
                  size="sm"
                  disabled={selectedDepts.length === 0}
                  onClick={handleGeoComplete}
                  className="gap-1.5"
                >
                  Commencer avec {selectedDepts.length} dept{selectedDepts.length > 1 ? "s" : ""}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}

          {step === "sector" && (
            <>
              <div className="text-center mb-4">
                <h2 className="text-xl font-bold">Choisissez vos secteurs d&apos;activite</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Selectionnez jusqu&apos;a 5 secteurs. Vos 300 leads seront repartis proportionnellement.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-[50vh] overflow-y-auto">
                {SECTOR_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleSector(s)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      selectedSectors.includes(s)
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                        : "hover:bg-gray-50 border-gray-200"
                    }`}
                  >
                    {selectedSectors.includes(s) && <Check className="h-3 w-3 inline mr-1" />}
                    {s}
                  </button>
                ))}
              </div>

              <div className="text-center text-xs text-muted-foreground mt-2">
                {selectedSectors.length}/5 secteurs selectionnes
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <Button variant="ghost" size="sm" onClick={() => setStep("geo")} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" /> Retour
                </Button>
                <Button
                  size="sm"
                  disabled={selectedSectors.length === 0}
                  onClick={handleSectorComplete}
                  className="gap-1.5"
                >
                  Voir mes 300 prospects
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
