import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { TrialGate } from "@/components/layout/trial-gate";
import { UpcomingAppointments } from "@/components/dashboard/upcoming-appointments";

export default function PipelinePage() {
  return (
    <TrialGate>
      <div className="flex h-[calc(100vh-45px)]">
        {/* Pipeline kanban — takes most of the space */}
        <div className="flex-1 min-w-0 px-4 py-4">
          <PipelineBoard />
        </div>

        {/* Sidebar droite — prochains RDV */}
        <div className="w-72 shrink-0 border-l border-border/40 px-3 py-4 overflow-y-auto hidden lg:block">
          <UpcomingAppointments />
        </div>
      </div>
    </TrialGate>
  );
}
