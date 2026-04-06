// Barrel re-export — all API routes import from "@/lib/queries" which resolves here

// Leads
export { getLeads, getLeadDetail, getHistoryLeads, getLeadsByDomains, getLeadsBySiren } from "./leads";

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

// Activity (Claude, Followups, Outreach Emails)
export {
  getClaudeActivities,
  addClaudeActivity,
  getClaudeStats,
  getClaudeAnalyzedCount,
  updateClaudeActivity,
  getFollowups,
  addFollowup,
  updateFollowup,
  addOutreachEmail,
  getOutreachEmails,
} from "./activity";
export type { OutreachEmail } from "./activity";

// Prospects (new navigation)
export { getProspects, getDomainCounts, getPresetCounts, getSetting, setSetting, getAllSettings } from "./prospects";
export type { ProspectFilters } from "./prospects";
