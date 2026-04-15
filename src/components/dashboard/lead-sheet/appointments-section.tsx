"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, ExternalLink, Plus, Clock, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Appointment = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  notes: string | null;
  status: string;
  sourceStage: string | null;
  googleEventUrl: string | null;
};

function defaultDatetime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AppointmentsSection({ siren, entreprise }: { siren: string; entreprise: string }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState(defaultDatetime());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments?siren=${siren}`);
      if (!res.ok) return;
      const data = await res.json();
      setAppointments(data.appointments || []);
    } finally {
      setLoading(false);
    }
  }, [siren]);

  useEffect(() => { refresh(); }, [refresh]);

  async function create() {
    const finalTitle = title.trim() || `RDV ${entreprise}`;
    if (!startAt) {
      toast.error("Date requise");
      return;
    }
    setSubmitting(true);
    try {
      const start = new Date(startAt);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siren,
          title: finalTitle,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        toast.error("Erreur création RDV");
        return;
      }
      const json = await res.json();
      toast.success("RDV créé");
      if (json.appointment?.googleEventUrl) {
        window.open(json.appointment.googleEventUrl, "_blank", "noopener,noreferrer");
      }
      setTitle("");
      setNotes("");
      setStartAt(defaultDatetime());
      setCreating(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function markDone(id: string) {
    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    refresh();
  }

  async function cancel(id: string) {
    await fetch(`/api/appointments/${id}`, { method: "DELETE" });
    refresh();
  }

  if (loading) {
    return <div className="text-xs text-muted-foreground">Chargement RDV…</div>;
  }

  const now = Date.now();
  const upcoming = appointments.filter((a) => a.status === "scheduled" && new Date(a.startAt).getTime() >= now);
  const past = appointments.filter((a) => a.status !== "scheduled" || new Date(a.startAt).getTime() < now);

  return (
    <div className="space-y-3" data-testid="appointments-section">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" /> RDV planifiés
          {upcoming.length > 0 && (
            <span className="rounded-full bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 text-[10px] text-blue-700 dark:text-blue-300">
              {upcoming.length}
            </span>
          )}
        </h4>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => setCreating((v) => !v)}
          data-testid="appointment-new"
        >
          <Plus className="h-3 w-3 mr-0.5" /> Nouveau
        </Button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-md border border-dashed p-2.5">
          <div>
            <Label className="text-[10px]">Titre</Label>
            <Input
              className="h-7 text-xs"
              placeholder={`RDV ${entreprise}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[10px]">Date et heure</Label>
            <Input
              type="datetime-local"
              className="h-7 text-xs"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              data-testid="appointment-start"
            />
          </div>
          <div>
            <Label className="text-[10px]">Notes</Label>
            <Textarea
              className="min-h-[50px] text-xs"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={create} disabled={submitting} data-testid="appointment-create">
              {submitting ? "…" : "Créer"}
            </Button>
          </div>
        </div>
      )}

      {upcoming.length === 0 && !creating && (
        <div className="text-[11px] text-muted-foreground italic">Aucun RDV à venir</div>
      )}

      {upcoming.map((a) => (
        <div key={a.id} className={cn("group rounded-md border px-2.5 py-1.5 text-xs")}>
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3 text-blue-500" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{a.title}</div>
              <div className="text-[10px] text-muted-foreground">{formatDateTime(a.startAt)}</div>
            </div>
            <div className="hidden group-hover:flex gap-0.5">
              {a.googleEventUrl && (
                <a href={a.googleEventUrl} target="_blank" rel="noopener noreferrer" title="Google Calendar">
                  <Button variant="ghost" size="icon" className="h-5 w-5"><ExternalLink className="h-3 w-3" /></Button>
                </a>
              )}
              <Button variant="ghost" size="icon" className="h-5 w-5 text-emerald-600" onClick={() => markDone(a.id)}>
                <CheckCircle2 className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-red-500" onClick={() => cancel(a.id)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {a.notes && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{a.notes}</p>}
        </div>
      ))}

      {past.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Historique ({past.length})
          </summary>
          <div className="mt-1.5 space-y-1">
            {past.slice(0, 10).map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-muted-foreground">
                <span className={cn(
                  "inline-block w-1.5 h-1.5 rounded-full",
                  a.status === "done" && "bg-emerald-400",
                  a.status === "cancelled" && "bg-red-300",
                  a.status === "scheduled" && "bg-slate-300",
                )} />
                <span className="truncate">{a.title}</span>
                <span className="ml-auto whitespace-nowrap">{formatDateTime(a.startAt)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
