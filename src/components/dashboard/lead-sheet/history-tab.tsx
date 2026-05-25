"use client";

/**
 * Onglet Historique — fiche prospect 360° Phase 1.
 *
 * Affiche le fil chronologique agrégé (pipeline_transitions + followups +
 * appointments) d'un prospect. Filtres par type + fenêtre de date.
 *
 * Phases 2-4 ajouteront : mails (mail v1/v2), appels Telnyx, polish pagination.
 */

import { useEffect, useMemo, useState } from "react";
import {
  History,
  Repeat,
  Bell,
  Calendar,
  Loader2,
  Mail,
  Phone,
  PhoneIncoming,
} from "lucide-react";
import { useWorkspacePipelineStages, findStageOrFallback } from "@/hooks/use-pipeline-stages";

type EventType =
  | "pipeline_transition"
  | "followup"
  | "appointment"
  | "mail_out"
  | "call";

interface PipelineTransitionEvent {
  type: "pipeline_transition";
  id: string;
  occurredAt: string;
  fromStage: string | null;
  toStage: string;
  userId: string | null;
}
interface FollowupEvent {
  type: "followup";
  id: string;
  occurredAt: string;
  status: string;
  note: string | null;
}
interface AppointmentEvent {
  type: "appointment";
  id: string;
  occurredAt: string;
  title: string;
  status: string;
  notes: string | null;
  sourceStage: string | null;
}
interface MailOutEvent {
  type: "mail_out";
  id: string;
  occurredAt: string;
  subject: string | null;
  bodyPreview: string | null;
  templateSlug: string | null;
  fromEmail: string;
  toEmails: string[];
  status: string;
}
interface CallEvent {
  type: "call";
  id: string;
  occurredAt: string;
  direction: string;
  status: string;
  durationSeconds: number | null;
  recordingPath: string | null;
  notes: string | null;
  provider: string;
}
type TimelineEvent =
  | PipelineTransitionEvent
  | FollowupEvent
  | AppointmentEvent
  | MailOutEvent
  | CallEvent;

interface HistoryTabProps {
  siren: string;
}

const TYPE_LABELS: Record<EventType, string> = {
  pipeline_transition: "Transitions",
  followup: "Rappels",
  appointment: "RDV",
  mail_out: "Mails envoyés",
  call: "Appels",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const DATE_RANGES: Array<{ id: string; label: string; days: number | null }> = [
  { id: "7d", label: "7 jours", days: 7 },
  { id: "30d", label: "30 jours", days: 30 },
  { id: "all", label: "Tout", days: null },
];

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryTab({ siren }: HistoryTabProps) {
  // Hook stages workspace pour résoudre les labels de transition. Le shape
  // est inchangé (slug + label) — un slug disparu (stage soft-deleted)
  // tombe sur le fallback synthétique du hook.
  const { stages: workspaceStages } = useWorkspacePipelineStages();
  const stageLabel = (stage: string | null): string => {
    if (!stage) return "—";
    return findStageOrFallback(workspaceStages, stage).label;
  };
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabledTypes, setEnabledTypes] = useState<Set<EventType>>(
    new Set(["pipeline_transition", "followup", "appointment", "mail_out", "call"]),
  );
  const [range, setRange] = useState<string>("all");

  useEffect(() => {
    if (!siren) return;
    setLoading(true);
    setError(null);

    const since =
      DATE_RANGES.find((r) => r.id === range)?.days != null
        ? new Date(
            Date.now() -
              DATE_RANGES.find((r) => r.id === range)!.days! *
                24 *
                60 *
                60 *
                1000,
          ).toISOString()
        : null;

    const url = new URL(
      `/api/leads/${encodeURIComponent(siren)}/timeline`,
      window.location.origin,
    );
    if (since) url.searchParams.set("since", since);

    fetch(url.toString())
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setEvents(Array.isArray(d?.events) ? d.events : []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [siren, range]);

  const filtered = useMemo(
    () => events.filter((e) => enabledTypes.has(e.type)),
    [events, enabledTypes],
  );

  function toggleType(t: EventType) {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Types
        </span>
        {(Object.keys(TYPE_LABELS) as EventType[]).map((t) => (
          <button
            key={t}
            onClick={() => toggleType(t)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              enabledTypes.has(t)
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
            }`}
            data-testid={`history-filter-${t}`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-3">
          Période
        </span>
        {DATE_RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              range === r.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
            }`}
            data-testid={`history-range-${r.id}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Etats */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3 w-3 animate-spin" /> Chargement de l&apos;historique...
        </div>
      )}
      {error && !loading && (
        <p className="text-xs text-red-600 py-2">
          Impossible de charger l&apos;historique : {error}
        </p>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground italic py-4" data-testid="history-empty">
          Aucun évènement pour les filtres sélectionnés.
        </p>
      )}

      {/* Timeline */}
      {!loading && filtered.length > 0 && (
        <ol className="space-y-3" data-testid="history-timeline">
          {filtered.map((evt) => (
            <li
              key={`${evt.type}-${evt.id}`}
              className="flex gap-3 border-l-2 border-slate-200 pl-3"
              data-testid={`history-event-${evt.type}`}
            >
              <div className="flex-shrink-0 -ml-[1.45rem] mt-0.5 h-5 w-5 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center">
                {evt.type === "pipeline_transition" && (
                  <Repeat className="h-2.5 w-2.5 text-slate-600" />
                )}
                {evt.type === "followup" && (
                  <Bell className="h-2.5 w-2.5 text-amber-600" />
                )}
                {evt.type === "appointment" && (
                  <Calendar className="h-2.5 w-2.5 text-blue-600" />
                )}
                {evt.type === "mail_out" && (
                  <Mail className="h-2.5 w-2.5 text-emerald-600" />
                )}
                {evt.type === "call" && evt.direction === "inbound" && (
                  <PhoneIncoming className="h-2.5 w-2.5 text-indigo-600" />
                )}
                {evt.type === "call" && evt.direction !== "inbound" && (
                  <Phone className="h-2.5 w-2.5 text-indigo-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{formatEventDate(evt.occurredAt)}</span>
                  <span className="uppercase tracking-wider">
                    {TYPE_LABELS[evt.type]}
                  </span>
                </div>
                {evt.type === "pipeline_transition" && (
                  <p className="text-xs text-slate-700">
                    Stage : <span className="italic">{stageLabel(evt.fromStage)}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="font-semibold">{stageLabel(evt.toStage)}</span>
                  </p>
                )}
                {evt.type === "followup" && (
                  <p className="text-xs text-slate-700">
                    <span className="font-medium">Rappel</span>{" "}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {evt.status}
                    </span>
                    {evt.note && (
                      <span className="block text-muted-foreground mt-0.5 line-clamp-2">
                        {evt.note}
                      </span>
                    )}
                  </p>
                )}
                {evt.type === "appointment" && (
                  <p className="text-xs text-slate-700">
                    <span className="font-medium">{evt.title}</span>{" "}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {evt.status}
                    </span>
                    {evt.sourceStage && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        (depuis {stageLabel(evt.sourceStage)})
                      </span>
                    )}
                    {evt.notes && (
                      <span className="block text-muted-foreground mt-0.5 line-clamp-2">
                        {evt.notes}
                      </span>
                    )}
                  </p>
                )}
                {evt.type === "mail_out" && (
                  <div className="text-xs text-slate-700">
                    <p>
                      <span className="font-semibold">
                        {evt.subject ?? "(sans objet)"}
                      </span>{" "}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        {evt.status}
                      </span>
                      {evt.templateSlug && (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {evt.templateSlug}
                        </span>
                      )}
                    </p>
                    {evt.toEmails.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        À&nbsp;: {evt.toEmails.join(", ")}
                      </p>
                    )}
                    <p className="block text-muted-foreground mt-0.5 line-clamp-2">
                      {evt.bodyPreview ?? "(sans contenu)"}
                    </p>
                  </div>
                )}
                {evt.type === "call" && (
                  <div className="text-xs text-slate-700">
                    <p>
                      <span className="font-medium">
                        {evt.direction === "inbound" ? "Appel reçu" : "Appel sortant"}
                      </span>{" "}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {evt.status}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-slate-600">
                        {formatDuration(evt.durationSeconds)}
                      </span>
                    </p>
                    {evt.recordingPath && (
                      <a
                        href={`/api/calls/${encodeURIComponent(evt.id)}/recording`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-0.5 text-[11px] px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                        data-testid="history-call-recording"
                      >
                        Écouter
                      </a>
                    )}
                    {evt.notes && (
                      <span className="block text-muted-foreground mt-0.5 line-clamp-2">
                        {evt.notes}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="text-[10px] text-muted-foreground italic flex items-center gap-1 pt-2 border-t">
        <History className="h-3 w-3" /> Phases 1-3 — mails entrants (Phase 2.5
        IMAP) et filtres avancés (Phase 4) arrivent.
      </p>
    </div>
  );
}
