// Barrel re-export — all API routes import from "@/lib/queries" which resolves here

// Leads
export { getLeads, getLeadDetail, getHistoryLeads } from "./leads";

// Stats
export { getStats } from "./stats";

// Pipeline & Outreach
export {
  getPipelineLeads,
  updateOutreach,
  patchOutreach,
  recordVisit,
  getPipelineColumnOrder,
  savePipelineColumnOrder,
  reorderPipelineCards,
  batchReorderPipelineCards,
} from "./pipeline";
export type { PipelineLead } from "./pipeline";

// Segments
export {
  getSmartSegmentLeads,
  getManualSegmentLeads,
  getPjSegmentLeads,
  getSegmentLeads,
  getSegmentCount,
  getAllSegmentCounts,
  addToSegment,
  removeFromSegment,
} from "./segments";

// Activity (Claude, Followups)
export {
  getClaudeActivities,
  addClaudeActivity,
  getClaudeStats,
  getClaudeAnalyzedCount,
  updateClaudeActivity,
  getFollowups,
  addFollowup,
  updateFollowup,
} from "./activity";

// Prospects (new navigation)
export { getProspects, getDomainCounts, getPresetCounts, getSetting, setSetting, getAllSettings } from "./prospects";
export type { ProspectFilters } from "./prospects";

// Refill leads — quota / décompte (ticket refill 1/3)
export { consumeLead, getLeadBalance } from "./lead-credits";
export type { LeadBalance } from "./lead-credits";

// Préférences workspace — switch mode agence + onboarding (ticket switch-mode-agence)
export {
  getWorkspacePreferences,
  updateWorkspacePreferences,
} from "./workspace-preferences";
export type {
  DisplayMode,
  WorkspacePreferences,
  WorkspacePreferencesPatch,
} from "./workspace-preferences";
