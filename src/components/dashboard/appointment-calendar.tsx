"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Appointment = {
  id: string;
  siren: string;
  startAt: string;
  endAt: string;
  title: string;
  status: string;
  sourceStage: string | null;
  googleEventUrl: string | null;
  notes: string | null;
};

const STAGE_COLORS: Record<string, { bg: string; border: string }> = {
  a_rappeler: { bg: "#fef3c7", border: "#f59e0b" },
  site_demo: { bg: "#ede9fe", border: "#8b5cf6" },
  default: { bg: "#dbeafe", border: "#3b82f6" },
};

export function AppointmentCalendar() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const calendarRef = useRef<FullCalendar | null>(null);
  const router = useRouter();

  const toEvent = useCallback((a: Appointment): EventInput => {
    const palette = STAGE_COLORS[a.sourceStage || "default"] || STAGE_COLORS.default;
    return {
      id: a.id,
      title: a.title,
      start: a.startAt,
      end: a.endAt,
      backgroundColor: palette.bg,
      borderColor: palette.border,
      textColor: "#1f2937",
      extendedProps: {
        siren: a.siren,
        status: a.status,
        sourceStage: a.sourceStage,
        googleEventUrl: a.googleEventUrl,
        notes: a.notes,
      },
    };
  }, []);

  const fetchAppointments = useCallback(async (from: Date, to: Date) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/appointments?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      if (!res.ok) {
        toast.error("Erreur chargement RDV");
        return;
      }
      const data = await res.json();
      const visible = (data.appointments || []).filter(
        (a: Appointment) => a.status !== "cancelled"
      );
      setEvents(visible.map(toEvent));
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, [toEvent]);

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 3600_000);
    const to = new Date(now.getTime() + 90 * 24 * 3600_000);
    fetchAppointments(from, to);
  }, [fetchAppointments]);

  async function handleEventDrop(arg: EventDropArg) {
    const { event } = arg;
    if (!event.start || !event.end) {
      arg.revert();
      return;
    }
    try {
      const res = await fetch(`/api/appointments/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt: event.start.toISOString(),
          endAt: event.end.toISOString(),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("RDV déplacé");
    } catch {
      toast.error("Erreur déplacement");
      arg.revert();
    }
  }

  async function handleEventResize(arg: EventResizeDoneArg) {
    const { event } = arg;
    if (!event.start || !event.end) {
      arg.revert();
      return;
    }
    try {
      const res = await fetch(`/api/appointments/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt: event.start.toISOString(),
          endAt: event.end.toISOString(),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Durée modifiée");
    } catch {
      toast.error("Erreur resize");
      arg.revert();
    }
  }

  function handleEventClick(arg: EventClickArg) {
    const siren = arg.event.extendedProps.siren;
    if (siren) router.push(`/prospects?siren=${siren}`);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-xs text-muted-foreground px-2 pb-2">
        Glisser-déposer pour déplacer · Redimensionner pour changer la durée · Clic = ouvrir la fiche
        {loading && <span className="ml-2">(chargement…)</span>}
      </div>
      <div className="flex-1 min-h-0">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          locale="fr"
          firstDay={1}
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
          nowIndicator
          editable
          eventResizableFromStart
          selectable={false}
          events={events}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          datesSet={(arg) => {
            // Refetch quand l'utilisateur change de periode
            fetchAppointments(arg.start, arg.end);
          }}
          height="100%"
          buttonText={{
            today: "Aujourd'hui",
            month: "Mois",
            week: "Semaine",
            day: "Jour",
          }}
        />
      </div>
    </div>
  );
}
