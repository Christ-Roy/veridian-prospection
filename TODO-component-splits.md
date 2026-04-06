# Components to split -- audit 2026-03-25

Components > 300 lines that should be decomposed. Listed by priority (biggest / most tangled first).

## 1. segment-page.tsx (1165 lines)
The biggest component. Contains the full segment view logic + several inline sub-components.

Suggested extractions:
- **SegmentIcon** (L67-115) -- small utility, used nowhere else but could live in its own file
- **SegmentTreeItem** (L1058-1111) -- sidebar tree nav item, self-contained
- **TechScoreBadge** (L1112-1124) -- reusable badge, also useful elsewhere
- **HoneypotBadge** (L1125-1153) -- reusable badge for PJ leads
- **QualificationScoreBadge** (L1154-end) -- reusable badge
- The main SegmentPage component itself is ~940 lines of rendering + state. The pagination/toolbar section (top bar with filters, seen toggle, page controls) could be extracted as a **SegmentToolbar** sub-component.

## 2. lead-sheet.tsx (1045 lines)
The lead detail side panel. Heavy with multiple sections rendered inline.

Suggested extractions:
- **ClaudeActivityCard** (L764-902) -- 138 lines, self-contained card with edit/save logic
- **QualificationBadge** (L903-915) -- tiny, reusable
- **FollowupSection** (L916-1012) -- 96 lines, manages followup list + add form
- **FollowupCard** (L1013-end) -- individual followup item
- The main LeadSheet body could be split into tab sections: **LeadInfoTab**, **LeadTechTab**, **LeadClaudeTab** since it already has visual sections.

## 3. advanced-filters.tsx (949 lines)
Mostly UI config for filter groups. Lots of repetitive filter field definitions.

Suggested extractions:
- **NafFilter** (L322-395) -- standalone NAF code picker with search
- The filter groups (identity, contact, tech, analytics, business, enrichment) are defined as data arrays -- these could move to a **filter-config.ts** data file, leaving the component much shorter.
- Preset management (save/load/delete custom presets) could be a **FilterPresets** sub-component.

## 4. leads-table.tsx (588 lines)
Main data table with sorting, pagination, search, filters sidebar.

Suggested extractions:
- The inline filter sidebar toggle + AdvancedFilters integration could be a wrapper component.
- Pagination controls are duplicated with segment-page.tsx -- consider a shared **PaginationBar** component.

## 5. guide-commercial.tsx (563 lines)
Static commercial guide page.

Suggested extractions:
- **Section**, **ICPCard**, **SignalRow** (L20-175) are already defined as local components. They could move to a `guide/` subfolder if the file gets touched again, but low priority since it's mostly static content.

## 6. pipeline-board.tsx (548 lines)
Kanban board with drag-and-drop.

Suggested extractions:
- **CompactCard** (L391-475) -- individual pipeline card
- **EmailComposeModal** (L476-end) -- email compose dialog, self-contained

## 7. segment-table.tsx (365 lines)
Borderline. Single export, mostly table rendering. Could extract column definitions to data file but not urgent.

## 8. calendar-dialog.tsx (349 lines)
Borderline. Calendar + time picker dialog. Mostly self-contained, low priority.
