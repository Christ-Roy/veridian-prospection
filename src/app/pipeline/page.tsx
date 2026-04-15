import { TrialGate } from "@/components/layout/trial-gate";
import { PipelineView } from "@/components/dashboard/pipeline-view";

export default function PipelinePage() {
  return (
    <TrialGate>
      <PipelineView />
    </TrialGate>
  );
}
