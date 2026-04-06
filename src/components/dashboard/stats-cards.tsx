"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { Stats } from "@/lib/types";
import {
  Building2,
  Users,
  Mail,
  Phone,
  UserCheck,
  AtSign,
  PhoneCall,
  MailPlus,
} from "lucide-react";

const STAT_CONFIG = [
  { key: "total", label: "Total leads", icon: Building2, color: "text-slate-600" },
  { key: "enriched", label: "Enrichis", icon: Users, color: "text-blue-600" },
  { key: "with_email", label: "Avec email", icon: Mail, color: "text-green-600" },
  { key: "with_phone", label: "Avec tel", icon: Phone, color: "text-emerald-600" },
  { key: "with_dirigeant", label: "Dirigeant", icon: UserCheck, color: "text-violet-600" },
  { key: "dirigeant_emails", label: "Email dirigeant", icon: AtSign, color: "text-pink-600" },
  { key: "with_aliases", label: "Aliases SMTP", icon: MailPlus, color: "text-cyan-600" },
  { key: "contacted", label: "Contactes", icon: PhoneCall, color: "text-orange-600" },
] as const;

export function StatsCards() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats);
  }, []);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
      {STAT_CONFIG.map((s) => {
        const Icon = s.icon;
        const value = stats ? stats[s.key as keyof Stats] : null;
        return (
          <Card key={s.key} className="py-3">
            <CardContent className="px-4 py-0">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {value != null ? value.toLocaleString("fr-FR") : "..."}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
