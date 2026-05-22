"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, MousePointerClick, Move } from "lucide-react";
import { appointmentPalette } from "@/lib/appointment-colors";
import { useMediaQuery } from "@/hooks/use-media-query";

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

export function AppointmentCalendar() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const calendarRef = useRef<FullCalendar | null>(null);
  const router = useRouter();

  // Sous `md`, FullCalendar passe en vue liste (lisible sur 375px).
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const toEvent = useCallback((a: Appointment): EventInput => {
    const palette = appointmentPalette(a.sourceStage);
    return {
      id: a.id,
      title: a.title,
      start: a.startAt,
      end: a.endAt,
      backgroundColor: palette.fcVar,
      borderColor: palette.fcBorderVar,
      extendedProps: {
        siren: a.siren,
        status: a.status,
        sourceStage: a.sourceStage,
        googleEventUrl: a.googleEventUrl,
        notes: a.notes,
      },
    };
  }, []);

  const fetchAppointments = useCallback(
    async (from: Date, to: Date) => {
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
    },
    [toEvent]
  );

  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 3600_000);
    const to = new Date(now.getTime() + 90 * 24 * 3600_000);
    fetchAppointments(from, to);
  }, [fetchAppointments]);

  // Bascule la vue quand on franchit le breakpoint md sans recharger la lib.
  // `initialView` couvre déjà le premier rendu — cet effet ne sert qu'au
  // redimensionnement en cours d'utilisation.
  useEffect(() => {
    if (isDesktop === undefined) return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    const target = isDesktop ? "timeGridWeek" : "listWeek";
    if (api.view.type !== target) api.changeView(target);
  }, [isDesktop]);

  async function patchSchedule(id: string, startAt: string, endAt: string) {
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt, endAt }),
    });
    if (!res.ok) throw new Error("patch failed");
  }

  async function handleEventDrop(arg: EventDropArg) {
    const { event } = arg;
    if (!event.start || !event.end) {
      arg.revert();
      return;
    }
    try {
      await patchSchedule(
        event.id,
        event.start.toISOString(),
        event.end.toISOString()
      );
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
      await patchSchedule(
        event.id,
        event.start.toISOString(),
        event.end.toISOString()
      );
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

  // Rendu custom des événements : titre lisible + plage horaire compacte.
  const renderEventContent = useCallback((arg: EventContentArg) => {
    const isListView = arg.view.type.startsWith("list");
    if (isListView) {
      // En vue liste, FullCalendar fournit déjà l'heure dans sa colonne.
      return (
        <div className="fc-appt-list-title">{arg.event.title}</div>
      );
    }
    return (
      <div className="fc-appt-block">
        {arg.timeText && <span className="fc-appt-time">{arg.timeText}</span>}
        <span className="fc-appt-name">{arg.event.title}</span>
      </div>
    );
  }, []);

  const headerToolbar = useMemo(
    () =>
      isDesktop === false
        ? {
            // Mobile : toolbar compacte, le sélecteur de vue est superflu
            // (la vue liste est imposée sous `md`).
            left: "prev,next",
            center: "title",
            right: "today",
          }
        : {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          },
    [isDesktop]
  );

  return (
    <div className="fc-veridian flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Move className="h-3.5 w-3.5" />
          Glisser pour déplacer
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          Redimensionner pour la durée
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MousePointerClick className="h-3.5 w-3.5" />
          Clic pour ouvrir la fiche
        </span>
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-foreground/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Chargement…
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isDesktop === undefined ? (
          // Viewport pas encore connu : on attend pour monter FullCalendar
          // avec la bonne vue d'emblée (évite un flash desktop ↔ liste).
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
        <FullCalendar
          ref={calendarRef}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          initialView={isDesktop ? "timeGridWeek" : "listWeek"}
          headerToolbar={headerToolbar}
          locale="fr"
          firstDay={1}
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
          allDaySlot={false}
          nowIndicator
          editable
          eventResizableFromStart
          selectable={false}
          dayMaxEvents={3}
          expandRows
          stickyHeaderDates
          eventDisplay="block"
          events={events}
          eventContent={renderEventContent}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          datesSet={(arg) => {
            // Refetch quand l'utilisateur change de période.
            fetchAppointments(arg.start, arg.end);
          }}
          height="100%"
          slotLabelFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          noEventsContent={() => (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <CalendarClock className="h-7 w-7 opacity-40" />
              <span className="text-sm">Aucun rendez-vous sur cette période</span>
            </div>
          )}
          buttonText={{
            today: "Aujourd'hui",
            month: "Mois",
            week: "Semaine",
            day: "Jour",
            list: "Liste",
          }}
        />
        )}
      </div>
    </div>
  );
}
