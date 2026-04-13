"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { INTEREST_SCALE } from "@/lib/types";
import { toast } from "sonner";

interface StageTransitionProps {
  open: boolean;
  targetStage: string;
  domain: string;
  dirigeant: string | null;
  onConfirm: (data: StageData) => void;
  onCancel: () => void;
}

export interface StageData {
  pipeline_stage: string;
  notes?: string;
  interest_pct?: number;
  deadline?: string;
  site_price?: number;
  acompte_pct?: number;
  acompte_amount?: number;
  monthly_recurring?: number;
  annual_deal?: boolean;
  estimated_value?: number;
}

// Default deadline: tomorrow at 10:00
function defaultDatetime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export function StageTransitionModal({ open, targetStage, dirigeant, onConfirm, onCancel }: StageTransitionProps) {
  const [note, setNote] = useState("");
  const [messageLaisse, setMessageLaisse] = useState(false);
  const [rappelDate, setRappelDate] = useState(defaultDatetime());
  const [interestPct, setInterestPct] = useState(50);
  const [demoDate, setDemoDate] = useState(defaultDatetime());
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [devisTotal, setDevisTotal] = useState("");
  const [acomptePct, setAcomptePct] = useState("30");
  const [mensuel, setMensuel] = useState("");
  const [annualDeal, setAnnualDeal] = useState(false);

  function handleConfirm() {
    const base: StageData = { pipeline_stage: targetStage };

    switch (targetStage) {
      case "repondeur":
        base.notes = messageLaisse
          ? `Repondeur — message laisse${note ? ` : ${note}` : ""} — ${new Date().toLocaleDateString("fr-FR")}`
          : `Repondeur — pas de message${note ? ` : ${note}` : ""} — ${new Date().toLocaleDateString("fr-FR")}`;
        break;

      case "a_rappeler":
        if (!rappelDate) { toast.error("Date de rappel requise"); return; }
        base.deadline = rappelDate;
        base.notes = `A rappeler le ${new Date(rappelDate).toLocaleDateString("fr-FR")} a ${new Date(rappelDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${dirigeant ? ` (${dirigeant})` : ""}${note ? ` — ${note}` : ""}`;
        break;

      case "site_demo":
        base.interest_pct = interestPct;
        base.deadline = demoDate || undefined;
        base.estimated_value = estimatedPrice ? parseFloat(estimatedPrice) : undefined;
        base.notes = `Site demo — interet ${interestPct}%${demoDate ? ` — RDV ${new Date(demoDate).toLocaleDateString("fr-FR")}` : ""}${estimatedPrice ? ` — estimé ${estimatedPrice}€` : ""}${note ? ` — ${note}` : ""}`;
        break;

      case "acompte":
        if (!devisTotal) { toast.error("Montant du devis requis"); return; }
        const total = parseFloat(devisTotal);
        const pct = parseInt(acomptePct) || 30;
        base.site_price = total;
        base.acompte_pct = pct;
        base.acompte_amount = Math.round(total * pct / 100);
        base.monthly_recurring = mensuel ? parseFloat(mensuel) : undefined;
        base.annual_deal = annualDeal;
        base.estimated_value = total;
        base.notes = `Acompte — devis ${total}€, acompte ${pct}% = ${Math.round(total * pct / 100)}€${mensuel ? `, recurrent ${mensuel}€/mois` : ""}${annualDeal ? " (annualise)" : ""}${note ? ` — ${note}` : ""}`;
        break;

      case "finition":
        base.notes = `Finition en cours${note ? ` — ${note}` : ""} — ${new Date().toLocaleDateString("fr-FR")}`;
        break;

      case "client":
        base.notes = `Client signe${note ? ` — ${note}` : ""} — ${new Date().toLocaleDateString("fr-FR")}`;
        if (mensuel) base.monthly_recurring = parseFloat(mensuel);
        break;

      case "upsell":
        base.notes = `Upsell SaaS${note ? ` — ${note}` : ""} — ${new Date().toLocaleDateString("fr-FR")}`;
        if (estimatedPrice) base.estimated_value = parseFloat(estimatedPrice);
        break;

      default:
        if (note) base.notes = note;
    }

    onConfirm(base);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stageLabel(targetStage)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ========== REPONDEUR ========== */}
          {targetStage === "repondeur" && (
            <>
              <div className="flex gap-2">
                <Button
                  variant={messageLaisse ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMessageLaisse(true)}
                  className="flex-1"
                >
                  Message laisse
                </Button>
                <Button
                  variant={!messageLaisse ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMessageLaisse(false)}
                  className="flex-1"
                >
                  Pas de message
                </Button>
              </div>
            </>
          )}

          {/* ========== A RAPPELER ========== */}
          {targetStage === "a_rappeler" && (
            <div>
              <Label className="text-xs">Date et heure du rappel</Label>
              <Input
                type="datetime-local"
                value={rappelDate}
                onChange={(e) => setRappelDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          )}

          {/* ========== SITE DEMO ========== */}
          {targetStage === "site_demo" && (
            <>
              <div>
                <Label className="text-xs mb-2 block">Niveau d&apos;interet</Label>
                <div className="space-y-1.5">
                  {INTEREST_SCALE.map((level) => (
                    <button
                      key={level.pct}
                      onClick={() => setInterestPct(level.pct)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all border ${
                        interestPct === level.pct
                          ? `${level.color} border-current font-semibold ring-2 ring-offset-1 ring-current`
                          : "bg-white border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="font-mono mr-2">{level.pct}%</span>
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Date butoir / RDV demo</Label>
                <Input
                  type="datetime-local"
                  value={demoDate}
                  onChange={(e) => setDemoDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Prix envisage (€)</Label>
                <Input
                  type="number"
                  value={estimatedPrice}
                  onChange={(e) => setEstimatedPrice(e.target.value)}
                  placeholder="Ex: 3000"
                  className="h-9 text-sm"
                />
              </div>
            </>
          )}

          {/* ========== ACOMPTE ========== */}
          {targetStage === "acompte" && (
            <>
              <div>
                <Label className="text-xs">Montant total du devis (€)</Label>
                <Input
                  type="number"
                  value={devisTotal}
                  onChange={(e) => setDevisTotal(e.target.value)}
                  placeholder="Ex: 3000"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Pourcentage d&apos;acompte</Label>
                <div className="flex gap-2">
                  {["30", "50", "100"].map(p => (
                    <Button
                      key={p}
                      variant={acomptePct === p ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAcomptePct(p)}
                    >
                      {p}%
                    </Button>
                  ))}
                  <Input
                    type="number"
                    value={acomptePct}
                    onChange={(e) => setAcomptePct(e.target.value)}
                    className="h-9 text-sm w-20"
                    min={0}
                    max={100}
                  />
                </div>
                {devisTotal && acomptePct && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Acompte: <span className="font-mono font-semibold">{Math.round(parseFloat(devisTotal) * parseInt(acomptePct) / 100)}€</span>
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Recurrent mensuel (€/mois)</Label>
                <Input
                  type="number"
                  value={mensuel}
                  onChange={(e) => setMensuel(e.target.value)}
                  placeholder="Ex: 49"
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="annual"
                  checked={annualDeal}
                  onChange={(e) => setAnnualDeal(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="annual" className="text-xs">Vente annualisee (paiement annuel)</Label>
              </div>
            </>
          )}

          {/* ========== CLIENT ========== */}
          {targetStage === "client" && (
            <div>
              <Label className="text-xs">Recurrent mensuel (€/mois)</Label>
              <Input
                type="number"
                value={mensuel}
                onChange={(e) => setMensuel(e.target.value)}
                placeholder="Ex: 49"
                className="h-9 text-sm"
              />
            </div>
          )}

          {/* ========== UPSELL ========== */}
          {targetStage === "upsell" && (
            <div>
              <Label className="text-xs">Prix estime upsell SaaS (€)</Label>
              <Input
                type="number"
                value={estimatedPrice}
                onChange={(e) => setEstimatedPrice(e.target.value)}
                placeholder="Ex: 99/mois"
                className="h-9 text-sm"
              />
            </div>
          )}

          {/* Note libre — toujours visible */}
          <div>
            <Label className="text-xs">Note (optionnel)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Commentaire libre..."
              className="min-h-[60px] text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Annuler</Button>
          <Button onClick={handleConfirm}>Confirmer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    fiche_ouverte: "Fiche ouverte",
    repondeur: "Repondeur",
    a_rappeler: "A rappeler",
    site_demo: "Site demo",
    acompte: "Acompte",
    finition: "Finition",
    client: "Client",
    upsell: "Upsell SaaS",
    archive: "Archiver",
  };
  return labels[stage] || stage;
}
