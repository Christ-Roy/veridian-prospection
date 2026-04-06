import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { TrialGate } from "@/components/layout/trial-gate";

export default function PipelinePage() {
  return (
    <TrialGate>
      <div className="px-4 py-4 h-[calc(100vh-45px)]">
        <PipelineBoard />
      </div>
    </TrialGate>
  );
}
