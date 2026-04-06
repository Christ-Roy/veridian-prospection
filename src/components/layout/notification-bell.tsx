"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Notification {
  type: "invitation" | "pipeline" | "system";
  message: string;
  time: string;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const [invRes, pipeRes] = await Promise.all([
          fetch("/api/admin/invitations").then(r => r.ok ? r.json() : null),
          fetch("/api/pipeline").then(r => r.ok ? r.json() : null),
        ]);

        const notifs: Notification[] = [];

        // Pending invitations
        const pending = (invRes?.invitations || []).filter(
          (i: { accepted_at?: string; revoked_at?: string }) => !i.accepted_at && !i.revoked_at
        );
        if (pending.length > 0) {
          notifs.push({
            type: "invitation",
            message: `${pending.length} invitation${pending.length > 1 ? "s" : ""} en attente`,
            time: pending[0]?.created_at || "",
          });
        }

        // Pipeline activity (leads in "rappeler" status)
        const rappeler = pipeRes?.pipeline?.rappeler || [];
        if (rappeler.length > 0) {
          notifs.push({
            type: "pipeline",
            message: `${rappeler.length} prospect${rappeler.length > 1 ? "s" : ""} a rappeler`,
            time: rappeler[0]?.contacted_date || "",
          });
        }

        setNotifications(notifs);
      } catch { /* silent */ }
    }

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000); // Every 60s
    return () => clearInterval(interval);
  }, []);

  const count = notifications.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md hover:bg-muted transition-colors"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">Aucune notification</p>
          ) : (
            notifications.map((n, i) => (
              <div key={i} className="px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {n.type === "invitation" ? "Invite" : n.type === "pipeline" ? "Pipeline" : "Systeme"}
                  </Badge>
                  <span className="text-sm truncate">{n.message}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
