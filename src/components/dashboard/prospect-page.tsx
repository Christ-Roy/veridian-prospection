"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./status-badge";
import { LeadSheet } from "./lead-sheet";
import { SectorSidebar } from "./sector-sidebar";
import {
  SansSiteSidebar,
  EMPTY_SANS_SITE_STATE,
  type SansSiteFilterState,
} from "./sans-site-sidebar";
import { FilterBar } from "./filter-bar";
import { GeoFilterSidebar } from "./geo-filter-sidebar";
import { SizeFilterSidebar, DEFAULT_SIZE_FILTER, type SizeFilterState } from "./size-filter-sidebar";
import { QualityFilterSidebar, DEFAULT_QUALITY_FILTER, type QualityFilterState } from "./quality-filter-sidebar";
import { formatCA, formatEffectifs } from "@/lib/types";
import { webHref } from "@/lib/utils";
import { toast } from "sonner";
import type { ProspectPreset } from "@/lib/domains";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpDown, ArrowUp, ArrowDown,
  Phone, Mail,
  ClipboardList, Eye, Bot, Archive,
} from "lucide-react";
import { BlurredText } from "@/components/ui/blurred-text";
import { useTrial } from "@/lib/trial-context";
import { Paywall } from "@/components/layout/paywall";
import { Onboarding } from "@/components/layout/onboarding";
import { useLocalStoragePersist } from "@/hooks/use-local-storage-persist";

const PAGE_SIZE = 50;


interface ProspectData {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function ProspectPage() {
  const trialState = useTrial();
  const [showPaywall, setShowPaywall] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [domain] = useState("all");
  const [selectedSecteurs, setSelectedSecteurs] = useLocalStoragePersist<string[]>("prospection:selectedSecteurs:v1", []);
  const [selectedDomaines, setSelectedDomaines] = useState<string[]>([]);
  // Persist dans localStorage pour restauration au reload (key versionnée)
  const [presets, setPresets] = useLocalStoragePersist<ProspectPreset[]>(
    "prospect-presets-v1",
    ["tous"],
  );
  const [data, setData] = useState<ProspectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useLocalStoragePersist<string>("prospection:sort:v1", "tech_score");
  const [sortDir, setSortDir] = useLocalStoragePersist<"asc" | "desc">("prospection:sortDir:v1", "desc");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filter states
  const [geoDepts, setGeoDepts] = useLocalStoragePersist<string[]>(
    "prospect-geo-depts-v1",
    [],
  );
  const [sizeFilter, setSizeFilter] = useState<SizeFilterState>(DEFAULT_SIZE_FILTER);
  const [qualityFilter, setQualityFilter] = useState<QualityFilterState>({
    ...DEFAULT_QUALITY_FILTER,
    hideDuplicateSiren: true,
    unseenOnly: true,
    requirePhone: true,
  });

  // Check onboarding status — skip if already has data (admin/returning user)
  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then(r => r.ok ? r.json() : {}),
      fetch("/api/health").then(r => r.ok ? r.json() : null),
    ])
      .then(([settings, health]: [Record<string, string>, { leadCount?: number } | null]) => {
        const onboardingDone = settings["settings.onboarding_done"];
        const hasLeads = health && (health.leadCount ?? 0) > 100;
        // Show onboarding only for fresh tenants without data and not yet completed
        if (!onboardingDone && !hasLeads) setShowOnboarding(true);
        setOnboardingChecked(true);
      })
      .catch(() => setOnboardingChecked(true));

    // Fetch today's contact count
    fetch("/api/stats/today").then(r => r.ok ? r.json() : null).then(d => { if (d) setTodayCount(d.today); }).catch(() => {});

    // Check for checkout success/cancel in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast.success("Paiement effectue ! Votre plan a ete active.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("checkout") === "cancel") {
      toast("Paiement annule", { duration: 3000 });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  function handleOnboardingComplete(config: { plan: string; departments: string[]; sectors?: string[] }) {
    // Save onboarding config
    setShowOnboarding(false);
    // Apply geo filter from onboarding
    setGeoDepts(config.departments);
    // Persist onboarding_done + selected departments
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        onboarding_done: "true",
        onboarding_plan: config.plan,
        onboarding_departments: config.departments.join(","),
        ...(config.sectors?.length ? { quota_sectors: config.sectors.join(",") } : {}),
      }),
    });
  }

  // Save/restore quality filters when toggling historique
  const savedFiltersRef = useRef<QualityFilterState | null>(null);

  // Animated dismiss: domains being archived after visit
  // phase: "waiting" (3s green bg growing) → "collapsing" (shrink out) → removed
  // "paused" = mouse is hovering, timer postponed
  // "cancelled" = user clicked during animation, stays forever
  const [dismissState, setDismissState] = useState<Record<string, { phase: "waiting" | "collapsing" | "paused" | "cancelled"; timer?: ReturnType<typeof setTimeout> }>>({});
  const dismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Filter sidebar open states
  const [geoOpen, setGeoOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);

  // Search
  const [searchTerm, setSearchTerm] = useState("");

  // Navbar "avec site / sans site" toggle — read from URL param `site`
  const searchParams = useSearchParams();
  const siteMode = (searchParams?.get("site") as "all" | "with" | "without" | null) ?? "all";

  // Sans-site sidebar state (only used when siteMode === "without")
  const [sansSiteFilter, setSansSiteFilter] =
    useState<SansSiteFilterState>(EMPTY_SANS_SITE_STATE);
  // Reset sans-site filters when leaving the "sans site" segment so they
  // don't silently get reapplied the next time the user toggles back.
  useEffect(() => {
    if (siteMode !== "without") setSansSiteFilter(EMPTY_SANS_SITE_STATE);
  }, [siteMode]);

  // When entering the sans-site segment, tech_score is always NULL so
  // sorting by it is meaningless — auto-switch to small_biz_score desc.
  // Symmetrically, if we leave sans-site while sorting by small_biz_score
  // (which will be NULL for avec-site rows), fall back to tech_score desc.
  useEffect(() => {
    if (siteMode === "without" && sort === "tech_score") {
      setSort("small_biz_score");
      setSortDir("desc");
    } else if (siteMode !== "without" && sort === "small_biz_score") {
      setSort("tech_score");
      setSortDir("desc");
    }
  }, [siteMode, sort]);

  // Build filter query params string
  const buildFilterParams = useCallback(() => {
    const p = new URLSearchParams();
    if (searchTerm) p.set("q", searchTerm);
    if (selectedSecteurs.length > 0) p.set("secteurs", selectedSecteurs.join(","));
    if (selectedDomaines.length > 0) p.set("domaines", selectedDomaines.join(","));
    if (geoDepts.length > 0) p.set("dept", geoDepts.join(","));
    if (sizeFilter.effectifsCodes.length > 0) p.set("effectifsCodes", sizeFilter.effectifsCodes.join(","));
    if (sizeFilter.mobileOnly) p.set("mobileOnly", "1");
    if (sizeFilter.caRanges.length > 0) p.set("caRanges", sizeFilter.caRanges.join(","));
    else if (sizeFilter.caMin != null) p.set("caMin", sizeFilter.caMin.toString());
    if (sizeFilter.caMax != null && sizeFilter.caRanges.length === 0) p.set("caMax", sizeFilter.caMax.toString());
    if (sizeFilter.operator !== "or") p.set("sizeOperator", sizeFilter.operator);
    if (qualityFilter.hideDuplicateSiren) p.set("hideDuplicateSiren", "1");
    if (qualityFilter.unseenOnly) p.set("unseenOnly", "1");
    if (qualityFilter.minTechScore > 0) p.set("minTechScore", qualityFilter.minTechScore.toString());
    if (qualityFilter.requirePhone) p.set("requirePhone", "1");
    if (qualityFilter.requireEmail) p.set("requireEmail", "1");
    if (qualityFilter.requireDirigeant) p.set("requireDirigeant", "1");
    if (qualityFilter.requireEnriched) p.set("requireEnriched", "1");
    if (qualityFilter.excludeAssociations) p.set("excludeAssociations", "1");
    if (qualityFilter.excludePhoneShared) p.set("excludePhoneShared", "1");
    if (qualityFilter.excludeHttpDead) p.set("excludeHttpDead", "1");
    if (qualityFilter.requireRge) p.set("requireRge", "1");
    if (qualityFilter.requireQualiopi) p.set("requireQualiopi", "1");
    if (qualityFilter.requireBio) p.set("requireBio", "1");
    if (siteMode === "with") p.set("hasWebsite", "1");
    else if (siteMode === "without") p.set("hasWebsite", "0");
    // Sans-site sidebar filters — only relevant when siteMode === "without"
    if (siteMode === "without") {
      if (sansSiteFilter.rge) p.set("requireRge", "1");
      if (sansSiteFilter.qualiopi) p.set("requireQualiopi", "1");
      if (sansSiteFilter.epv) p.set("requireEpv", "1");
      if (sansSiteFilter.bni) p.set("requireBni", "1");
      if (sansSiteFilter.bio) p.set("requireBio", "1");
      if (sansSiteFilter.nonIdentifieAvecTel) p.set("nonIdentifieAvecTel", "1");
      if (sansSiteFilter.qualiopiSpecialite)
        p.set("qualiopiSpecialite", sansSiteFilter.qualiopiSpecialite);
    }
    return p.toString();
  }, [searchTerm, selectedSecteurs, selectedDomaines, geoDepts, sizeFilter, qualityFilter, siteMode, sansSiteFilter]);

  // Active filter count (for badges on filter buttons)
  const activeFilterCount = {
    geo: geoDepts.length > 0 ? 1 : 0,
    taille: (sizeFilter.effectifsCodes.length > 0 || sizeFilter.mobileOnly || sizeFilter.caMin != null || sizeFilter.caMax != null) ? 1 : 0,
    qualite: (qualityFilter.hideDuplicateSiren || qualityFilter.unseenOnly || qualityFilter.minTechScore > 0 || qualityFilter.requirePhone || qualityFilter.requireEmail || qualityFilter.requireDirigeant || qualityFilter.requireEnriched || qualityFilter.excludeAssociations || qualityFilter.excludePhoneShared || qualityFilter.excludeHttpDead || qualityFilter.requireRge || qualityFilter.requireQualiopi || qualityFilter.requireBio) ? 1 : 0,
  };

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      domain,
      preset: presets.join(","),
      page: page.toString(),
      pageSize: PAGE_SIZE.toString(),
      sort,
      sortDir,
    });
    // Append filter params
    const filterStr = buildFilterParams();
    if (filterStr) {
      for (const [k, v] of new URLSearchParams(filterStr)) {
        params.set(k, v);
      }
    }
    try {
      const res = await fetch(`/api/prospects?${params}`);
      const json = await res.json();
      setData(json);
    } catch {
      toast.error("Erreur de chargement");
    }
    setLoading(false);
  }, [domain, presets, page, sort, sortDir, buildFilterParams]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [domain, presets, geoDepts, sizeFilter, qualityFilter, siteMode, sansSiteFilter]);

  function toggleSort(col: string) {
    if (sort === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSort(col); setSortDir(col === "tech_score" || col === "ca" || col === "small_biz_score" ? "desc" : "asc"); }
    setPage(1);
  }

  function toggleSelect(d: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(d)) next.delete(d); else next.add(d); return next; });
  }

  function toggleSelectAll() {
    if (!data) return;
    const visible = data.data.map(l => l.domain as string);
    const allSel = visible.every(d => selected.has(d));
    setSelected(prev => { const next = new Set(prev); if (allSel) visible.forEach(d => next.delete(d)); else visible.forEach(d => next.add(d)); return next; });
  }

  // --- Dismiss animation system ---
  function startDismiss(domain: string) {
    // Start "waiting" phase: 3s green bg animation, then collapse
    setDismissState(prev => ({ ...prev, [domain]: { phase: "waiting" } }));
    const timer = setTimeout(() => {
      // Move to collapsing
      setDismissState(prev => {
        if (prev[domain]?.phase !== "waiting") return prev;
        return { ...prev, [domain]: { phase: "collapsing" } };
      });
      // After collapse animation, remove
      setTimeout(() => removeDismissed(domain), 500);
    }, 3000);
    dismissTimers.current[domain] = timer;
  }

  function pauseDismiss(domain: string) {
    // Mouse enter: pause the timer, postpone
    const state = dismissState[domain];
    if (!state || state.phase !== "waiting") return;
    clearTimeout(dismissTimers.current[domain]);
    setDismissState(prev => ({ ...prev, [domain]: { phase: "paused" } }));
  }

  function resumeDismiss(domain: string) {
    // Mouse leave: restart 30s timer
    const state = dismissState[domain];
    if (!state || state.phase !== "paused") return;
    setDismissState(prev => ({ ...prev, [domain]: { phase: "waiting" } }));
    const timer = setTimeout(() => {
      setDismissState(prev => {
        if (prev[domain]?.phase !== "waiting") return prev;
        return { ...prev, [domain]: { phase: "collapsing" } };
      });
      setTimeout(() => removeDismissed(domain), 500);
    }, 30000);
    dismissTimers.current[domain] = timer;
  }

  function cancelDismiss(domain: string) {
    // Click during animation: cancel, stays until next visit
    clearTimeout(dismissTimers.current[domain]);
    setDismissState(prev => {
      const next = { ...prev };
      delete next[domain];
      return next;
    });
  }

  function removeDismissed(domain: string) {
    setDismissState(prev => {
      const next = { ...prev };
      delete next[domain];
      return next;
    });
    setData(prev => prev ? {
      ...prev,
      data: prev.data.filter(r => r.domain !== domain),
      total: prev.total - 1,
    } : prev);
    setTodayCount(prev => prev + 1);
  }
  // --- End dismiss system ---

  function handleOpenFilter(f: "geo" | "taille" | "qualite") {
    if (f === "geo") setGeoOpen(true);
    else if (f === "taille") setSizeOpen(true);
    else if (f === "qualite") setQualityOpen(true);
  }

  const allSelected = data && data.data.length > 0 && data.data.every(l => selected.has(l.domain as string));

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Filter bar */}
      <div className="flex items-center justify-between border-b bg-white dark:bg-gray-900 dark:border-gray-800 px-3 md:px-4 py-1.5 gap-2 overflow-x-auto">
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">
            <strong>{data ? data.total.toLocaleString() : "..."}</strong> prospects
          </span>
          {data && data.total <= 300 && (
            <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full" title="Quota freemium — passez au plan Geo pour debloquer">
              {data.total} / 300
            </span>
          )}
          {todayCount > 0 && (
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              {todayCount} aujourd&apos;hui
            </span>
          )}
          {selected.size > 0 && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l">
              <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                {selected.size} selectionne{selected.size > 1 ? "s" : ""}
              </span>
              <select
                className="text-xs border rounded px-1.5 py-0.5 bg-white dark:bg-gray-800"
                defaultValue=""
                onChange={(e) => {
                  const status = e.target.value;
                  if (!status) return;
                  Promise.all(
                    Array.from(selected).map(siren =>
                      fetch(`/api/leads/${siren}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status }),
                      })
                    )
                  ).then(() => {
                    setSelected(new Set());
                    fetchData();
                  });
                  e.target.value = "";
                }}
              >
                <option value="">Changer statut...</option>
                <option value="fiche_ouverte">Fiche ouverte</option>
                <option value="appele">Appele</option>
                <option value="interesse">Interesse</option>
                <option value="rappeler">A rappeler</option>
                <option value="pas_interesse">Pas interesse</option>
                <option value="hors_cible">Hors cible</option>
              </select>
              <button
                className="text-xs text-red-600 hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Deselectionner
              </button>
            </div>
          )}
        </div>
        <FilterBar
          onOpenFilter={handleOpenFilter}
          activeFilters={activeFilterCount}
          onSearch={(term) => { setSearchTerm(term); setPage(1); }}
          searchValue={searchTerm}
          mobileOnly={sizeFilter.mobileOnly}
          onToggleMobile={() => { setSizeFilter(prev => ({ ...prev, mobileOnly: !prev.mobileOnly })); setPage(1); }}
          onHistorique={() => {
            savedFiltersRef.current = { ...qualityFilter };
            setQualityFilter({ ...DEFAULT_QUALITY_FILTER });
            setPresets(["historique"]);
            setPage(1);
          }}
          onClearHistorique={() => {
            if (savedFiltersRef.current) setQualityFilter(savedFiltersRef.current);
            setPresets(["tous"]);
            setPage(1);
          }}
          isHistoriqueActive={presets.includes("historique")}
        />
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {siteMode === "without" ? (
          <SansSiteSidebar value={sansSiteFilter} onChange={setSansSiteFilter} />
        ) : (
          <SectorSidebar
            selectedSecteurs={selectedSecteurs}
            selectedDomaines={selectedDomaines}
            onSelect={(s, d) => { setSelectedSecteurs(s); setSelectedDomaines(d); setPage(1); }}
          />
        )}

        <main className="flex-1 p-3 md:p-4 space-y-4 min-w-0 overflow-auto">
          {/* Table */}
          <div className="border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-800 overflow-x-auto shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected ?? false} onCheckedChange={toggleSelectAll} />
                  </TableHead>
                  <TableHead className="w-[180px] cursor-pointer" onClick={() => toggleSort("domain")}>
                    Domaine <SortIcon col="domain" />
                  </TableHead>
                  <TableHead className="max-w-[200px] cursor-pointer" onClick={() => toggleSort("nom_entreprise")}>
                    Entreprise <SortIcon col="nom_entreprise" />
                  </TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("ville")}>
                    Loc. <SortIcon col="ville" />
                  </TableHead>
                  <TableHead className="w-24 cursor-pointer text-right hidden md:table-cell" onClick={() => toggleSort("effectifs")}>
                    Eff. <SortIcon col="effectifs" />
                  </TableHead>
                  <TableHead className="w-24 cursor-pointer text-right hidden md:table-cell" onClick={() => toggleSort("ca")}>
                    CA <SortIcon col="ca" />
                  </TableHead>
                  {siteMode === "without" ? (
                    // No website → "Dette tech" is meaningless, swap for
                    // the small-biz fit score (sort key `small_biz_score`).
                    <TableHead
                      className="w-20 text-center cursor-pointer"
                      title="Score de fit petites entreprises solides sans site (0-100)"
                      onClick={() => toggleSort("small_biz_score")}
                    >
                      Small biz <SortIcon col="small_biz_score" />
                    </TableHead>
                  ) : (
                    <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("tech_score")}>
                      Dette <SortIcon col="tech_score" />
                    </TableHead>
                  )}
                  <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("eclate_score")}>
                    Eclate <SortIcon col="eclate_score" />
                  </TableHead>
                  <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("outreach_status")}>
                    Status <SortIcon col="outreach_status" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}
                {!loading && data?.data.map((lead) => {
                  const dom = lead.domain as string;
                  const ds = dismissState[dom];
                  return (
                    <ProspectRow
                      key={dom}
                      lead={lead}
                      isSelected={selected.has(dom)}
                      dismissPhase={ds?.phase}
                      todayCount={todayCount}
                      onSelect={() => toggleSelect(dom)}
                      onClick={() => {
                        if (trialState.isExpired) { setShowPaywall(true); return; }
                        if (ds) { cancelDismiss(dom); } else { setSelectedDomain(dom); }
                      }}
                      onMouseEnter={() => ds && pauseDismiss(dom)}
                      onMouseLeave={() => ds && resumeDismiss(dom)}
                    />
                  );
                })}
                {!loading && data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <ClipboardList className="h-8 w-8 opacity-20" />
                        <p className="font-medium">Aucun prospect dans cette selection</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-2">
              <p className="text-xs text-muted-foreground">
                <strong>{(data.page - 1) * data.pageSize + 1}-{Math.min(data.page * data.pageSize, data.total)}</strong> sur <strong>{data.total.toLocaleString()}</strong>
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 w-8 p-0"><ChevronsLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 w-8 p-0"><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="h-8 w-8 p-0"><ChevronRight className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(data.totalPages)} className="h-8 w-8 p-0"><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}

          <LeadSheet
            domain={selectedDomain}
            onClose={() => {
              const visited = selectedDomain;
              setSelectedDomain(null);
              if (visited && qualityFilter.unseenOnly) {
                startDismiss(visited);
              }
            }}
            onUpdated={() => { /* no reload — background save, sheet stays open */ }}
          />
        </main>
      </div>

      {/* Filter sidebars */}
      <GeoFilterSidebar
        open={geoOpen}
        onOpenChange={setGeoOpen}
        selectedDepts={geoDepts}
        onApply={(depts) => { setGeoDepts(depts); toast.success(`Filtre geo: ${depts.length > 0 ? depts.length + " dept(s)" : "desactive"}`); }}
      />
      <SizeFilterSidebar
        open={sizeOpen}
        onOpenChange={setSizeOpen}
        current={sizeFilter}
        onApply={(f) => { setSizeFilter(f); toast.success("Filtre taille applique"); }}
      />
      <QualityFilterSidebar
        open={qualityOpen}
        onOpenChange={setQualityOpen}
        current={qualityFilter}
        onApply={(f) => { setQualityFilter(f); toast.success("Filtre qualite applique"); }}
      />

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} />
      {onboardingChecked && <Onboarding open={showOnboarding} onComplete={handleOnboardingComplete} />}
    </div>
  );
}

// --- Row sub-component ---

function ProspectRow({ lead, isSelected, dismissPhase, todayCount, onSelect, onClick, onMouseEnter, onMouseLeave }: {
  lead: Record<string, unknown>;
  isSelected: boolean;
  dismissPhase?: "waiting" | "collapsing" | "paused" | "cancelled";
  todayCount?: number;
  onSelect: () => void;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const l = lead as Record<string, string | number | null>;
  const isArchiving = dismissPhase === "waiting" || dismissPhase === "paused";
  const isCollapsing = dismissPhase === "collapsing";
  return (
    <TableRow
      className={`cursor-pointer transition-all ${
        isCollapsing
          ? "opacity-0 max-h-0 overflow-hidden duration-500"
          : isArchiving
            ? "bg-green-50 duration-[3000ms]"
            : "hover:bg-muted/30 duration-150"
      } ${isSelected && !isArchiving ? "bg-primary/5" : ""}`}
      style={isCollapsing ? { transformOrigin: "top", lineHeight: 0, fontSize: 0, padding: 0 } : undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <TableCell onClick={e => e.stopPropagation()} className="relative">
        {isArchiving ? (
          <div className="flex items-center justify-center gap-1">
            <Archive className="h-3.5 w-3.5 text-green-600" />
            <svg className={`h-3.5 w-3.5 ${dismissPhase === "waiting" ? "" : "pause-spin"}`} viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="8" fill="none" stroke="#d1d5db" strokeWidth="2" />
              <circle
                cx="10" cy="10" r="8" fill="none" stroke="#16a34a" strokeWidth="2"
                strokeDasharray="50.26"
                strokeDashoffset="50.26"
                strokeLinecap="round"
                style={{
                  animation: dismissPhase === "waiting" ? "dismiss-countdown 3s linear forwards" : "dismiss-countdown 30s linear forwards",
                  transformOrigin: "center",
                  transform: "rotate(-90deg)",
                }}
              />
            </svg>
          </div>
        ) : (
          <Checkbox checked={isSelected} onCheckedChange={onSelect} />
        )}
        {/* Green progress bar on left edge */}
        {isArchiving && (
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-green-500" />
        )}
      </TableCell>
      <TableCell className="font-medium max-w-[200px]">
        <div className="flex items-center gap-1.5 truncate">
          {(l.web_domain as string) ? (
            <a
              href={webHref(l.web_domain as string)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-semibold text-primary truncate hover:underline"
            >
              <BlurredText>{l.web_domain as string}</BlurredText>
            </a>
          ) : (
            <span className="text-xs italic text-muted-foreground truncate">sans site</span>
          )}
          {((l.web_domain_count as number) ?? 0) > 1 && (
            <span
              className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 font-mono shrink-0"
              title={`${l.web_domain_count} sites web connus`}
            >
              +{(l.web_domain_count as number) - 1}
            </span>
          )}
          {l.last_visited && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 inline-flex items-center gap-0.5 shrink-0">
              <Eye className="h-3 w-3" />
            </span>
          )}
          {((l.claude_activity_count as number) ?? 0) > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 inline-flex items-center gap-0.5 shrink-0">
              <Bot className="h-3 w-3" /> {l.claude_activity_count as number}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-[200px]">
        <div className="flex items-center gap-1.5 truncate">
          <BlurredText className="text-sm font-semibold">{(l.nom_entreprise as string) || "-"}</BlurredText>
          {l.prospect_tier && (
            <span
              className={`text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ${
                l.prospect_tier === "gold" ? "bg-yellow-100 text-yellow-800" :
                l.prospect_tier === "silver" ? "bg-gray-100 text-gray-600" :
                "bg-amber-50 text-amber-700"
              }`}
              title={[
                `Score: ${l.prospect_score ?? "?"}`,
                l.ca_trend_3y ? `Tendance CA: ${l.ca_trend_3y}` : null,
                l.profitability_tag ? `Rentabilite: ${l.profitability_tag}` : null,
              ].filter(Boolean).join(" | ")}
            >
              {(l.prospect_tier as string).toUpperCase()}
            </span>
          )}
        </div>
        {l.dirigeant && (l.dirigeant as string).trim() !== "" && (
          <div className="truncate text-xs text-muted-foreground"><BlurredText>{`${l.dirigeant as string}${l.qualite_dirigeant ? ` - ${l.qualite_dirigeant as string}` : ""}`}</BlurredText></div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5 text-xs">
          {l.phone && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" /> <BlurredText className="truncate">{l.phone as string}</BlurredText>
            </div>
          )}
          {(l.email || l.dirigeant_email) && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <BlurredText className="truncate">{(l.dirigeant_email || l.email) as string}</BlurredText>
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {l.ville && <div className="truncate"><BlurredText>{l.ville as string}</BlurredText></div>}
        {l.departement && <div className="text-xs font-mono">({l.departement as string})</div>}
        {l.secteur_final && <div className="text-[10px] text-indigo-600 truncate">{l.secteur_final as string}</div>}
      </TableCell>
      <TableCell className="text-right text-sm hidden md:table-cell">
        {formatEffectifs(l.effectifs as string) !== "-" ? (
          <Badge variant="outline" className="font-normal">{formatEffectifs(l.effectifs as string)}</Badge>
        ) : "-"}
      </TableCell>
      <TableCell className="text-right text-sm font-mono text-muted-foreground hidden md:table-cell">
        {formatCA(l.ca as number)}
      </TableCell>
      <TableCell className="text-center">
        {/* When the prospect has no website, small_biz_score is computed
            by buildLeadsSelect and tech_score is irrelevant — show the
            small-biz fit badge instead. */}
        {l.small_biz_score != null ? (
          <SmallBizBadge score={l.small_biz_score as number} />
        ) : (
          <TechScoreBadge score={l.tech_score as number} />
        )}
      </TableCell>
      <TableCell className="text-center">
        <EclateBadge score={l.eclate_score as number} />
      </TableCell>
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          <span title={l.contacted_date ? `Contacte le ${new Date(l.contacted_date as string).toLocaleDateString("fr-FR")}` : undefined}>
            <StatusBadge status={l.outreach_status as string} ficheOuverteCount={todayCount} />
          </span>
          {(l.outreach_status === "a_contacter" || !l.outreach_status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                fetch(`/api/leads/${l.domain}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "fiche_ouverte" }),
                }).then(r => {
                  if (r.ok) {
                    // Optimistic update — change the status locally
                    (l as Record<string, unknown>).outreach_status = "fiche_ouverte";
                    // Force re-render by triggering a minor state change
                    window.dispatchEvent(new Event("prospect-status-changed"));
                  }
                });
              }}
              className="h-5 w-5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center transition-colors"
              title="Ajouter au pipeline"
            >
              +
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function TechScoreBadge({ score }: { score: number }) {
  if (score == null || score === 0) return <span className="text-xs text-muted-foreground">-</span>;
  let color = "bg-green-100 text-green-800";
  if (score >= 30) color = "bg-red-100 text-red-800";
  else if (score >= 15) color = "bg-orange-100 text-orange-800";
  else if (score >= 5) color = "bg-yellow-100 text-yellow-800";
  return (
    <span className={`inline-flex items-center justify-center h-6 min-w-[2rem] px-1.5 rounded-full text-xs font-bold ${color}`}>
      {score}
    </span>
  );
}

function SmallBizBadge({ score }: { score: number }) {
  if (score == null) return <span className="text-xs text-muted-foreground">-</span>;
  // 0-100: higher = better fit (TPE solide sans site)
  let color = "bg-gray-100 text-gray-600";
  if (score >= 80) color = "bg-emerald-100 text-emerald-800";
  else if (score >= 60) color = "bg-green-100 text-green-800";
  else if (score >= 40) color = "bg-yellow-100 text-yellow-800";
  else if (score >= 20) color = "bg-orange-100 text-orange-800";
  // Native tooltip = breakdown de la formule. Au hover, Robert voit d'un
  // coup d'oeil pourquoi ce lead est à 100 (ou à 55) et peut prioriser.
  const title =
    "Small-biz fit score — TPE solide sans site web\n" +
    "+25  1-9 salaries (tranche 01/02/03)\n" +
    "+25  Marge EBE > 10%  (ou +15 si > 5%)\n" +
    "+15  CA > 100 k€\n" +
    "+15  CA > 500 k€\n" +
    "+15  Resultat net > 0\n" +
    "+5   Telephone disponible\n" +
    "Max 100 — trier desc pour cibler les quick-close";
  return (
    <span
      className={`inline-flex items-center justify-center h-6 min-w-[2rem] px-1.5 rounded-full text-xs font-bold ${color}`}
      title={title}
    >
      {score}
    </span>
  );
}

function EclateBadge({ score }: { score: number }) {
  if (score == null || score === 0) return <span className="text-xs text-muted-foreground">-</span>;
  let color = "bg-yellow-100 text-yellow-800";
  if (score >= 3) color = "bg-red-100 text-red-800";
  else if (score >= 2) color = "bg-orange-100 text-orange-800";
  return (
    <span className={`inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full text-xs font-bold ${color}`}>
      {score}/3
    </span>
  );
}
