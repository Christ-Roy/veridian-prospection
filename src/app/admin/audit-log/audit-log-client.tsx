"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface AuditEvent {
  type: "invitation" | "outreach" | "member" | "deploy";
  description: string;
  actor?: string;
  timestamp: string;
}

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/invitations").then(r => r.ok ? r.json() : { invitations: [] }),
      fetch("/api/admin/members").then(r => r.ok ? r.json() : { members: [] }),
      fetch("/api/changelog").then(r => r.ok ? r.json() : { commits: [] }),
    ]).then(([invData, membData, changelog]) => {
      const events: AuditEvent[] = [];

      // Invitations
      for (const inv of (invData.invitations || []).slice(0, 10)) {
        events.push({
          type: "invitation",
          description: `Invitation envoyee a ${inv.email} (${inv.role})`,
          timestamp: inv.created_at || inv.createdAt,
        });
      }

      // Members
      for (const m of (membData.members || []).slice(0, 10)) {
        for (const ws of (m.memberships || [])) {
          events.push({
            type: "member",
            description: `${m.email} a rejoint ${ws.workspaceName} (${ws.role})`,
            timestamp: ws.joinedAt || m.joinedAt,
          });
        }
      }

      // Deploys
      for (const c of (changelog.commits || []).slice(0, 5)) {
        events.push({
          type: "deploy",
          description: `Deploy: ${c.subject}`,
          actor: c.author,
          timestamp: c.date,
        });
      }

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(events);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground">Chargement...</div>;

  const typeColors: Record<string, string> = {
    invitation: "bg-blue-100 text-blue-700",
    outreach: "bg-green-100 text-green-700",
    member: "bg-purple-100 text-purple-700",
    deploy: "bg-orange-100 text-orange-700",
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Journal d&apos;audit</h1>
        <p className="text-sm text-muted-foreground">Activite recente du workspace</p>
      </div>

      <div className="space-y-2">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg">
            <Badge className={`text-[10px] shrink-0 ${typeColors[e.type] || "bg-gray-100"}`}>
              {e.type}
            </Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{e.description}</p>
              {e.actor && <p className="text-xs text-muted-foreground">{e.actor}</p>}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {e.timestamp ? formatDistanceToNow(new Date(e.timestamp), { addSuffix: true, locale: fr }) : "—"}
            </span>
          </div>
        ))}
        {events.length === 0 && (
          <p className="text-center py-8 text-muted-foreground">Aucune activite recente</p>
        )}
      </div>
    </div>
  );
}
