"use client";

import { useEffect, useState, useCallback } from "react";
import { Calendar, Clock, Phone, ExternalLink, CheckCircle2, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Appointment = {
  id: string;
  siren: string;
  startAt: string;
  endAt: string;
  title: string;
  location: string | null;
  notes: string | null;
  status: string;
  sourceStage: string | null;
  googleEventUrl: string | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === tomorrow.toDateString()) return "Demain";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function stageIcon(stage: string | null) {
  if (stage === "a_rappeler") return <Phone className="h-3.5 w-3.5 text-amber-500" />;
  if (stage === "site_demo") return <Calendar className="h-3.5 w-3.5 text-purple-500" />;
  return <Clock className="h-3.5 w-3.5 text-blue-500" />;
}

function stageColor(stage: string | null) {
  if (stage === "a_rappeler") return "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950";
  if (stage === "site_demo") return "border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950";
  return "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950";
}

function urgencyLabel(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return { text: "En retard", color: "text-red-600 font-semibold" };
  if (diff < 30 * 60_000) return { text: "< 30 min", color: "text-red-500 font-medium" };
  if (diff < 2 * 3600_000) return { text: "< 2h", color: "text-amber-600" };
  return null;
}

export function UpcomingAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAppointments = useCallback(async () => {
    try {
      const now = new Date();
      const weekLater = new Date(now.getTime() + 7 * 24 * 3600_000);
      const res = await fetch(
        `/api/appointments?from=${now.toISOString()}&to=${weekLater.toISOString()}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setAppointments(
        (data.appointments || []).filter((a: Appointment) => a.status === "scheduled")
      );
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
    // Refresh every 2 minutes
    const interval = setInterval(fetchAppointments, 120_000);
    return () => clearInterval(interval);
  }, [fetchAppointments]);

  async function markDone(id: string) {
    try {
      await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      toast.success("RDV marqué terminé");
      fetchAppointments();
    } catch {
      toast.error("Erreur");
    }
  }

  async function cancel(id: string) {
    try {
      await fetch(`/api/appointments/${id}`, { method: "DELETE" });
      toast.success("RDV annulé");
      fetchAppointments();
    } catch {
      toast.error("Erreur");
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
        Chargement des RDV...
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
        <Calendar className="h-5 w-5 mx-auto mb-1 opacity-40" />
        Aucun RDV prévu cette semaine
      </div>
    );
  }

  // Group by date
  const grouped = new Map<string, Appointment[]>();
  for (const appt of appointments) {
    const key = formatDate(appt.startAt);
    const list = grouped.get(key) || [];
    list.push(appt);
    grouped.set(key, list);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          Prochains RDV
          <span className="ml-1.5 rounded-full bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
            {appointments.length}
          </span>
        </h3>
        <button
          onClick={fetchAppointments}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Rafraîchir"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {[...grouped.entries()].map(([dateLabel, appts]) => (
        <div key={dateLabel}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
            {dateLabel}
          </div>
          <div className="space-y-1.5">
            {appts.map((appt) => {
              const urgency = urgencyLabel(appt.startAt);
              return (
                <div
                  key={appt.id}
                  className={cn(
                    "group relative rounded-lg border px-3 py-2 transition-all hover:shadow-sm",
                    stageColor(appt.sourceStage)
                  )}
                >
                  <div className="flex items-start gap-2">
                    {stageIcon(appt.sourceStage)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{appt.title}</span>
                        {urgency && (
                          <span className={cn("text-[10px]", urgency.color)}>
                            {urgency.text}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {formatTime(appt.startAt)} – {formatTime(appt.endAt)}
                        {appt.location && <span className="ml-1">· {appt.location}</span>}
                      </div>
                      {appt.notes && (
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-1">
                          {appt.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions — visible on hover */}
                  <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                    {appt.googleEventUrl && (
                      <a
                        href={appt.googleEventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ouvrir dans Google Calendar"
                      >
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-emerald-600"
                      title="Marquer terminé"
                      onClick={() => markDone(appt.id)}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-500"
                      title="Annuler"
                      onClick={() => cancel(appt.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
