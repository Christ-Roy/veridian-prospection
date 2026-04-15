"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bell } from "lucide-react";

type Prefs = {
  reminderPush: boolean;
  reminderMinutesBefore: number;
  dailyDigest: boolean;
};

const DEFAULT_PREFS: Prefs = {
  reminderPush: true,
  reminderMinutesBefore: 30,
  dailyDigest: false,
};

export function NotificationPreferencesForm() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/user/notification-preferences");
        if (res.ok) {
          const data = await res.json();
          if (data.prefs) {
            setPrefs({
              reminderPush: data.prefs.reminderPush ?? true,
              reminderMinutesBefore: data.prefs.reminderMinutesBefore ?? 30,
              dailyDigest: data.prefs.dailyDigest ?? false,
            });
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/user/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) {
        toast.error("Erreur enregistrement");
        return;
      }
      toast.success("Préférences enregistrées");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border/50 p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <Label className="text-sm font-semibold">Rappels push des RDV</Label>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Notifications navigateur (PWA) avant chaque rendez-vous planifié.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.reminderPush}
            data-testid="toggle-reminder-push"
            onClick={() => setPrefs((p) => ({ ...p, reminderPush: !p.reminderPush }))}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              prefs.reminderPush ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
                prefs.reminderPush ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className={prefs.reminderPush ? "" : "opacity-50 pointer-events-none"}>
          <Label className="text-xs" htmlFor="minutes-before">
            Envoyer le rappel combien de minutes avant le RDV ?
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              id="minutes-before"
              type="number"
              min={1}
              max={1440}
              value={prefs.reminderMinutesBefore}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  reminderMinutesBefore: Math.max(1, Math.min(1440, Number(e.target.value) || 30)),
                }))
              }
              className="w-24 h-8 text-sm"
              data-testid="input-minutes-before"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
            <div className="flex gap-1 ml-2">
              {[15, 30, 60, 120].map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPrefs((p) => ({ ...p, reminderMinutesBefore: m }))}
                >
                  {m >= 60 ? `${m / 60}h` : `${m}m`}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-sm font-semibold">Récap quotidien</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Notification le matin résumant les RDV du jour (bientôt).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.dailyDigest}
            data-testid="toggle-daily-digest"
            onClick={() => setPrefs((p) => ({ ...p, dailyDigest: !p.dailyDigest }))}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              prefs.dailyDigest ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
                prefs.dailyDigest ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} data-testid="save-notification-prefs">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}
