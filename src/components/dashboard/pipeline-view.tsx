"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { UpcomingAppointments } from "@/components/dashboard/upcoming-appointments";
import { Button } from "@/components/ui/button";
import { LayoutList, CalendarDays, Loader2 } from "lucide-react";

// FullCalendar (~5 packages @fullcalendar/*) ne charge que sur la vue
// "Calendrier" — sorti du bundle initial de /pipeline via code-split.
const AppointmentCalendar = dynamic(
  () =>
    import("@/components/dashboard/appointment-calendar").then(
      (m) => m.AppointmentCalendar,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    ),
  },
);

type View = "list" | "calendar";

export function PipelineView() {
  const [view, setView] = useState<View>("list");

  return (
    <div className="flex h-[calc(100vh-45px)] flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <div className="inline-flex rounded-md border border-border/50 bg-background p-0.5">
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("list")}
            data-testid="pipeline-view-list"
          >
            <LayoutList className="h-3.5 w-3.5 mr-1.5" />
            Pipeline
          </Button>
          <Button
            variant={view === "calendar" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("calendar")}
            data-testid="pipeline-view-calendar"
          >
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
            Calendrier
          </Button>
        </div>
      </div>

      {view === "list" ? (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 px-4 py-3">
            <PipelineBoard />
          </div>
          <div className="w-72 shrink-0 border-l border-border/40 px-3 py-3 overflow-y-auto hidden lg:block">
            <UpcomingAppointments />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 px-4 py-3">
          <AppointmentCalendar />
        </div>
      )}
    </div>
  );
}
