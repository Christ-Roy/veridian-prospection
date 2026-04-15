"use client";

import { useState } from "react";
import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { UpcomingAppointments } from "@/components/dashboard/upcoming-appointments";
import { AppointmentCalendar } from "@/components/dashboard/appointment-calendar";
import { Button } from "@/components/ui/button";
import { LayoutList, CalendarDays } from "lucide-react";

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
