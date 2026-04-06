"use client";

import { useEffect, useState } from "react";
import { Building2, Users, Mail, Phone } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type KpiCard = {
  key: "workspaces" | "members" | "invitations" | "outreach";
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number | null;
  failed?: boolean;
};

export default function AdminIndexPage() {
  const [cards, setCards] = useState<KpiCard[]>([
    { key: "workspaces", label: "Workspaces", hint: "Équipes du tenant", icon: Building2, value: null },
    { key: "members", label: "Membres", hint: "Utilisateurs actifs", icon: Users, value: null },
    { key: "invitations", label: "Invitations pending", hint: "En attente d'acceptation", icon: Mail, value: null },
    { key: "outreach", label: "Outreach total", hint: "Toutes équipes confondues", icon: Phone, value: null },
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const fetchJson = async (url: string): Promise<unknown | null> => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      };

      const [wsData, membersData, invitesData, kpiData] = await Promise.all([
        fetchJson("/api/admin/workspaces"),
        fetchJson("/api/admin/members"),
        fetchJson("/api/admin/invitations?status=pending"),
        fetchJson("/api/admin/kpi"),
      ]);

      if (cancelled) return;

      const workspaceCount = Array.isArray(wsData) ? wsData.length : null;

      let memberCount: number | null = null;
      if (membersData && typeof membersData === "object") {
        const body = membersData as { members?: unknown[] };
        memberCount = Array.isArray(body.members) ? body.members.length : 0;
      }

      let invitesCount: number | null = null;
      if (Array.isArray(invitesData)) {
        invitesCount = invitesData.length;
      } else if (invitesData && typeof invitesData === "object") {
        const body = invitesData as { invitations?: unknown[] };
        if (Array.isArray(body.invitations)) invitesCount = body.invitations.length;
      }

      let outreachTotal: number | null = null;
      if (kpiData && typeof kpiData === "object") {
        const body = kpiData as {
          workspaces?: Array<{ outreach?: { total?: number } }>;
        };
        if (Array.isArray(body.workspaces)) {
          outreachTotal = body.workspaces.reduce(
            (acc, w) => acc + (w.outreach?.total ?? 0),
            0
          );
        }
      }

      setCards((prev) =>
        prev.map((c) => {
          switch (c.key) {
            case "workspaces":
              return { ...c, value: workspaceCount, failed: workspaceCount === null };
            case "members":
              return { ...c, value: memberCount, failed: memberCount === null };
            case "invitations":
              return { ...c, value: invitesCount, failed: invitesCount === null };
            case "outreach":
              return { ...c, value: outreachTotal, failed: outreachTotal === null };
          }
        })
      );
      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Vue d&apos;ensemble</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tableau de bord administrateur
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.key}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {c.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold">
                    {c.failed || c.value === null ? "—" : c.value.toLocaleString("fr-FR")}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">{c.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
