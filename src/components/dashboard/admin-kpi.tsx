"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface OverviewData {
  entreprises: {
    total: number;
    withPhone: number;
    withEmail: number;
    withSite: number;
    certifications: Record<string, number>;
    scoring: { diamond: number; gold: number };
  };
  inpi: {
    withCA: number;
    withHistory: number;
    growthStrong: number;
    decline: number;
    crash: number;
    topProfit: number;
  };
  pipeline: { status: string; count: number }[];
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 dark:border-gray-700 border rounded-lg p-4 shadow-sm">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{typeof value === "number" ? value.toLocaleString("fr-FR") : value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function AdminKpiDashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [trialData, setTrialData] = useState<{ plan: string; daysLeft: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats/overview").then(r => r.ok ? r.json() : null),
      fetch("/api/trial").then(r => r.ok ? r.json() : null),
    ]).then(([overview, trial]) => {
      setData(overview);
      setTrialData(trial);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Chargement...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">Erreur chargement KPI</div>;

  const { entreprises: e, inpi, pipeline } = data;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">KPI Dashboard</h1>
        <p className="text-sm text-muted-foreground">Vue d ensemble de la base prospects</p>
      </div>

      {/* Plan & Quota */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Plan & Quota</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Plan actuel"
            value={(trialData?.plan ?? "freemium").toUpperCase()}
            sub={trialData?.plan === "enterprise" ? "Acces illimite" : trialData?.plan === "pro" ? "Acces zone geo" : "300 leads max"}
          />
          <StatCard
            label="Jours restants"
            value={trialData?.daysLeft ?? "?"}
            sub={trialData && trialData.daysLeft > 365 ? "Illimite" : "Essai gratuit"}
          />
          <div className="bg-white dark:bg-gray-800 dark:border-gray-700 border rounded-lg p-4 shadow-sm col-span-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Upgrade</p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  fetch("/api/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plan: "geo" }),
                  }).then(r => r.json()).then(d => { if (d.url) window.location.href = d.url; });
                }}
                className="px-3 py-1.5 text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Geo ~20€/mois
              </button>
              <button
                onClick={() => {
                  fetch("/api/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plan: "full" }),
                  }).then(r => r.json()).then(d => { if (d.url) window.location.href = d.url; });
                }}
                className="px-3 py-1.5 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
              >
                Full ~50€/mois
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Cliquez pour acceder au paiement securise Stripe</p>
          </div>
        </div>
      </section>

      {/* Entreprises */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Base entreprises</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total entreprises" value={e.total} />
          <StatCard label="Avec telephone" value={e.withPhone} sub={`${Math.round(e.withPhone / e.total * 100)}%`} />
          <StatCard label="Avec email" value={e.withEmail} sub={`${Math.round(e.withEmail / e.total * 100)}%`} />
          <StatCard label="Avec site web" value={e.withSite} sub={`${Math.round(e.withSite / e.total * 100)}%`} />
        </div>
      </section>

      {/* Scoring */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Scoring prospects</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Diamond (score 80+)" value={e.scoring.diamond} />
          <StatCard label="Gold (score 60+)" value={e.scoring.gold} />
        </div>
      </section>

      {/* Certifications */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Certifications</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(e.certifications).map(([key, val]) => (
            <StatCard key={key} label={key.toUpperCase()} value={val} />
          ))}
        </div>
      </section>

      {/* INPI Financial */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Sante financiere (INPI)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="CA renseigne" value={inpi.withCA} />
          <StatCard label="Historique INPI" value={inpi.withHistory} />
          <StatCard label="Croissance forte" value={inpi.growthStrong} />
          <StatCard label="Top rentable" value={inpi.topProfit} />
          <StatCard label="En declin" value={inpi.decline} />
          <StatCard label="En chute" value={inpi.crash} />
        </div>
      </section>

      {/* Pipeline */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Pipeline commercial</h2>
        <div className="flex flex-wrap gap-2">
          {pipeline.map(p => (
            <Badge key={p.status} variant="outline" className="text-sm px-3 py-1">
              {p.status}: <strong className="ml-1">{p.count}</strong>
            </Badge>
          ))}
          {pipeline.length === 0 && <p className="text-sm text-muted-foreground">Aucune activite pipeline</p>}
        </div>
      </section>
    </div>
  );
}
