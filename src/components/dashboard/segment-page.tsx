"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./status-badge";
import { LeadSheet } from "./lead-sheet";
import { formatCA, formatEffectifs, formatTimeAgo } from "@/lib/types";
import { toast } from "sonner";
import type { Lead } from "@/lib/types";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpDown, ArrowUp, ArrowDown,
  Phone, Mail, AlertTriangle, Lock,
  Trash2, Loader2, ClipboardList,
  ChevronDown, ChevronRight as ChevronR,
  ArrowRightLeft, Zap, Eye, Star, Globe, ExternalLink, Bot,
  PhoneCall, PhoneOff, PhoneForwarded, CalendarClock, XCircle, CheckCircle2,
} from "lucide-react";

interface SegmentInfo {
  id: string;
  label: string;
  icon: string;
  type: "smart" | "manual" | "pj";
  count: number;
  parentId: string | null;
}

interface SegmentLead extends Lead {
  tech_score: number;
  segment_added_at: string | null;
  segment_notes: string | null;
  claude_activity_count?: number;
  // PJ fields
  pj_url?: string | null;
  activites_pj?: string | null;
  rating_pj?: string | null;
  nb_avis_pj?: number | null;
  pj_website_url?: string | null;
  pj_description?: string | null;
  is_solocal?: number | null;
  pj_id?: string | null;
  honeypot_score?: number | null;
  honeypot_flag?: string | null;
  honeypot_reasons?: string | null;
}

interface SegmentResponse {
  data: SegmentLead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  claudeAnalyzed?: number;
}

const PAGE_SIZE = 50;

function SegmentIcon({ name }: { name: string }) {
  // Simple icon mapping — just use first letter + color
  const iconMap: Record<string, { letter: string; color: string }> = {
    PhoneCall: { letter: "📞", color: "bg-emerald-600" },
    MapPin: { letter: "69", color: "bg-blue-600" },
    Bot: { letter: "🤖", color: "bg-cyan-600" },
    HardHat: { letter: "B", color: "bg-orange-600" },
    Sparkles: { letter: "N", color: "bg-cyan-600" },
    Ruler: { letter: "I", color: "bg-indigo-600" },
    Home: { letter: "Im", color: "bg-green-600" },
    Heart: { letter: "S", color: "bg-red-500" },
    Scissors: { letter: "Be", color: "bg-pink-500" },
    UtensilsCrossed: { letter: "R", color: "bg-amber-600" },
    ShoppingBag: { letter: "C", color: "bg-violet-600" },
    Car: { letter: "A", color: "bg-slate-600" },
    GraduationCap: { letter: "F", color: "bg-teal-600" },
    Briefcase: { letter: "Co", color: "bg-gray-600" },
    Wrench: { letter: "Re", color: "bg-yellow-700" },
    Monitor: { letter: "IT", color: "bg-sky-600" },
    Scale: { letter: "D", color: "bg-purple-700" },
    Truck: { letter: "T", color: "bg-emerald-700" },
    Factory: { letter: "In", color: "bg-zinc-600" },
    Leaf: { letter: "Ag", color: "bg-lime-600" },
    Dumbbell: { letter: "Sp", color: "bg-rose-600" },
    Shield: { letter: "As", color: "bg-blue-800" },
    ClipboardCheck: { letter: "Au", color: "bg-indigo-700" },
    MapPinCheck: { letter: "📍", color: "bg-green-700" },
    BookOpen: { letter: "PJ", color: "bg-yellow-600" },
    Trash2: { letter: "🗑", color: "bg-gray-500" },
    Phone: { letter: "📱", color: "bg-green-600" },
    AlertTriangle: { letter: "⚠", color: "bg-red-600" },
    Trophy: { letter: "🏆", color: "bg-yellow-500" },
    Store: { letter: "TP", color: "bg-amber-600" },
    Zap: { letter: "⚡", color: "bg-red-500" },
    Star: { letter: "★", color: "bg-yellow-500" },
    Building2: { letter: "PM", color: "bg-blue-700" },
    Landmark: { letter: "GE", color: "bg-purple-700" },
    Globe: { letter: "🌍", color: "bg-teal-600" },
    Mountain: { letter: "⛰", color: "bg-emerald-700" },
    Folder: { letter: "?", color: "bg-gray-500" },
  };
  const icon = iconMap[name] || iconMap.Folder;
  return (
    <span className={`inline-flex items-center justify-center h-6 w-6 rounded text-[10px] font-bold text-white ${icon.color}`}>
      {icon.letter}
    </span>
  );
}

export function SegmentPage({ segmentId }: { segmentId: string | null }) {
  const [segments, setSegments] = useState<SegmentInfo[]>([]);
  const [data, setData] = useState<SegmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSegments, setLoadingSegments] = useState(true);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("tech_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filterSeen, setFilterSeen] = useState<"all" | "seen" | "unseen">("all");
  const [filterClaude, setFilterClaude] = useState<"all" | "analyzed" | "not_analyzed">("all");
  const [filterHoneypot, setFilterHoneypot] = useState<"all" | "safe" | "suspect">("all");
  const [filterAppele, setFilterAppele] = useState<"non_appele" | "appele" | "all">("non_appele");

  // Fetch segments tree
  useEffect(() => {
    setLoadingSegments(true);
    fetch("/api/segments")
      .then(async (r) => {
        const text = await r.text();
        if (!text) return [] as SegmentInfo[];
        try {
          return JSON.parse(text) as SegmentInfo[];
        } catch {
          return [] as SegmentInfo[];
        }
      })
      .then((d) => { setSegments(d); setLoadingSegments(false); })
      .catch(() => setLoadingSegments(false));
  }, []);

  // Fetch segment data
  const fetchData = useCallback(async () => {
    if (!segmentId) { setData(null); setLoading(false); return; }
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: PAGE_SIZE.toString(),
      sort,
      sortDir,
    });
    if (filterSeen !== "all") params.set("seen", filterSeen);
    if (filterClaude !== "all") params.set("claude", filterClaude);
    if (filterHoneypot !== "all") params.set("honeypot", filterHoneypot);
    if (filterAppele !== "all") params.set("appele", filterAppele);
    try {
      const res = await fetch(`/api/segments/${segmentId}?${params}`);
      const text = await res.text();
      // Protection contre body vide (204, 404 sans body, etc.) post-SIREN refactor
      if (!text) {
        setData(null);
      } else {
        try {
          setData(JSON.parse(text));
        } catch (e) {
          console.warn("[segment-page] Failed to parse JSON response:", e);
          setData(null);
        }
      }
    } catch (e) {
      console.warn("[segment-page] Fetch failed:", e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [segmentId, page, sort, sortDir, filterSeen, filterClaude, filterHoneypot, filterAppele]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [segmentId]);

  const currentSegment = segments.find(s => s.id === segmentId);
  const isPj = currentSegment?.type === "pj" || segmentId?.startsWith("pagesjaunes");
  const isClaude = segmentId === "claude";
  const isColdcall = segmentId === "coldcall" || segmentId?.startsWith("coldcall/");
  const rootSegments = segments.filter(s => !s.parentId);
  const childSegments = (parentId: string) => segments.filter(s => s.parentId === parentId);

  function toggleSort(col: string) {
    if (sort === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSort(col); setSortDir(col === "tech_score" ? "desc" : "asc"); }
    setPage(1);
  }

  function toggleSelect(domain: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain); else next.add(domain);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!data) return;
    const visible = data.data.map(l => l.domain);
    const allSelected = visible.every(d => selected.has(d));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) visible.forEach(d => next.delete(d));
      else visible.forEach(d => next.add(d));
      return next;
    });
  }

  const visibleAllSelected = data && data.data.length > 0 && data.data.every(l => selected.has(l.domain));

  async function handleTransfer(targetSegment: string) {
    if (selected.size === 0) return;
    setTransferring(true);
    const toastId = toast.loading(`Transfert de ${selected.size} lead(s)...`);
    try {
      const res = await fetch(`/api/segments/${targetSegment}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: Array.from(selected) }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(`${result.added} lead(s) ajoute(s) a "${targetSegment}"`, { id: toastId });
        setSelected(new Set());
      } else {
        toast.error(result.error || "Erreur", { id: toastId });
      }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    } finally {
      setTransferring(false);
    }
  }

  async function handleRemove() {
    if (selected.size === 0 || !segmentId) return;
    setRemoving(true);
    const toastId = toast.loading(`Retrait de ${selected.size} lead(s)...`);
    try {
      const res = await fetch(`/api/segments/${segmentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: Array.from(selected) }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(`${result.removed} lead(s) retire(s)`, { id: toastId });
        setSelected(new Set());
        fetchData();
      } else {
        toast.error(result.error || "Erreur", { id: toastId });
      }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    } finally {
      setRemoving(false);
    }
  }

  // Quick status change for cold calling
  async function handleQuickStatus(domain: string, status: string, e: React.MouseEvent) {
    e.stopPropagation();
    const now = new Date().toISOString().replace("T", " ").split(".")[0];
    try {
      const res = await fetch(`/api/outreach/${domain}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          notes: "",
          contact_method: status === "appele" ? "phone" : "",
          contacted_date: status === "appele" ? now : "",
          qualification: null,
        }),
      });
      if (res.ok) {
        toast.success(
          status === "appele" ? `${domain} marqué appelé` :
          status === "rappeler" ? `${domain} → à rappeler` :
          status === "pas_interesse" ? `${domain} → pas intéressé` :
          status === "rdv" ? `${domain} → RDV` :
          status === "interesse" ? `${domain} → intéressé` :
          `${domain} → ${status}`
        );
        fetchData();
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  }

  // Get manual segments for transfer targets
  const manualSegments = segments.filter(s => s.type === "manual");

  return (
    <div className="min-h-screen">
      <div className="flex">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "w-64" : "w-0"} transition-all duration-200 border-r bg-white overflow-hidden flex-shrink-0`}>
          <div className="p-3 w-64">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Segments</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSidebarOpen(false)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>

            {loadingSegments ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (
              <nav className="space-y-0.5">
                {rootSegments.map(seg => (
                  <SegmentTreeItem
                    key={seg.id}
                    segment={seg}
                    subItems={childSegments(seg.id)}
                    currentId={segmentId}
                  />
                ))}
              </nav>
            )}
          </div>
        </aside>

        {/* Toggle sidebar button when closed */}
        {!sidebarOpen && (
          <button
            className="border-r bg-white px-1 py-2 hover:bg-muted transition-colors flex items-center"
            onClick={() => setSidebarOpen(true)}
          >
            <ChevronR className="h-4 w-4 text-muted-foreground" />
          </button>
        )}

        {/* Main content */}
        <main className="flex-1 p-4 space-y-4 min-w-0">
          {!segmentId ? (
            // Overview: show all segments as cards
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {segments.map(seg => (
                <Link
                  key={seg.id}
                  href={`/segments/${seg.id}`}
                  className="border rounded-lg bg-white p-4 hover:shadow-md transition-shadow flex items-center gap-3"
                >
                  <SegmentIcon name={seg.icon} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{seg.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {seg.count.toLocaleString()} leads
                      {seg.type === "manual" && <Badge variant="outline" className="ml-2 text-[10px] h-4">Manuel</Badge>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            // Segment content
            <>
              {/* Segment info bar */}
              <div className="flex items-center gap-4 bg-white p-4 rounded-lg border shadow-sm">
                <SegmentIcon name={currentSegment?.icon || "Folder"} />
                <div>
                  <span className="text-sm font-medium">
                    {currentSegment?.label || segmentId}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {data ? `${data.total.toLocaleString()} leads` : "..."}
                    {data?.claudeAnalyzed != null && data.claudeAnalyzed > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5">
                        <Bot className="h-3 w-3" /> {data.claudeAnalyzed} analyses
                      </span>
                    )}
                  </span>
                </div>
                {currentSegment?.type === "smart" && (
                  <Badge variant="secondary" className="ml-2 gap-1">
                    <Zap className="h-3 w-3" /> Smart
                  </Badge>
                )}
                {currentSegment?.type === "manual" && (
                  <Badge variant="outline" className="ml-2">Manuel</Badge>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={filterSeen === "seen" ? "secondary" : "ghost"}
                    className={`h-8 gap-1.5 ${filterSeen === "seen" ? "border border-violet-200 bg-violet-50 text-violet-700" : ""}`}
                    onClick={() => { setFilterSeen(f => f === "seen" ? "all" : "seen"); setPage(1); }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Deja vus
                  </Button>
                  <Button
                    size="sm"
                    variant={filterSeen === "unseen" ? "secondary" : "ghost"}
                    className={`h-8 gap-1.5 ${filterSeen === "unseen" ? "border border-green-200 bg-green-50 text-green-700" : ""}`}
                    onClick={() => { setFilterSeen(f => f === "unseen" ? "all" : "unseen"); setPage(1); }}
                  >
                    Nouveaux
                  </Button>
                  <span className="w-px h-5 bg-border" />
                  <Button
                    size="sm"
                    variant={filterClaude === "analyzed" ? "secondary" : "ghost"}
                    className={`h-8 gap-1.5 ${filterClaude === "analyzed" ? "border border-cyan-200 bg-cyan-50 text-cyan-700" : ""}`}
                    onClick={() => { setFilterClaude(f => f === "analyzed" ? "all" : "analyzed"); setPage(1); }}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Analyses
                  </Button>
                  <Button
                    size="sm"
                    variant={filterClaude === "not_analyzed" ? "secondary" : "ghost"}
                    className={`h-8 gap-1.5 ${filterClaude === "not_analyzed" ? "border border-gray-200 bg-gray-50 text-gray-600" : ""}`}
                    onClick={() => { setFilterClaude(f => f === "not_analyzed" ? "all" : "not_analyzed"); setPage(1); }}
                  >
                    Non analyses
                  </Button>
                  {isPj && (
                    <>
                      <span className="w-px h-5 bg-border" />
                      <Button
                        size="sm"
                        variant={filterHoneypot === "safe" ? "secondary" : "ghost"}
                        className={`h-8 gap-1.5 ${filterHoneypot === "safe" ? "border border-green-200 bg-green-50 text-green-700" : ""}`}
                        onClick={() => { setFilterHoneypot(f => f === "safe" ? "all" : "safe"); setPage(1); }}
                      >
                        Safe only
                      </Button>
                      <Button
                        size="sm"
                        variant={filterHoneypot === "suspect" ? "secondary" : "ghost"}
                        className={`h-8 gap-1.5 ${filterHoneypot === "suspect" ? "border border-red-200 bg-red-50 text-red-700" : ""}`}
                        onClick={() => { setFilterHoneypot(f => f === "suspect" ? "all" : "suspect"); setPage(1); }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Honeypots
                      </Button>
                    </>
                  )}
                  {isColdcall && (
                    <>
                      <span className="w-px h-5 bg-border" />
                      <Button
                        size="sm"
                        variant={filterAppele === "non_appele" ? "secondary" : "ghost"}
                        className={`h-8 gap-1.5 ${filterAppele === "non_appele" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}
                        onClick={() => { setFilterAppele("non_appele"); setPage(1); }}
                      >
                        <PhoneCall className="h-3.5 w-3.5" />
                        A appeler
                      </Button>
                      <Button
                        size="sm"
                        variant={filterAppele === "appele" ? "secondary" : "ghost"}
                        className={`h-8 gap-1.5 ${filterAppele === "appele" ? "border border-sky-200 bg-sky-50 text-sky-700" : ""}`}
                        onClick={() => { setFilterAppele("appele"); setPage(1); }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Appeles
                      </Button>
                      <Button
                        size="sm"
                        variant={filterAppele === "all" ? "secondary" : "ghost"}
                        className={`h-8 gap-1.5 ${filterAppele === "all" ? "border border-gray-200 bg-gray-50 text-gray-600" : ""}`}
                        onClick={() => { setFilterAppele("all"); setPage(1); }}
                      >
                        Tous
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Selection action bar */}
              {selected.size > 0 && (
                <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">
                      {selected.size} lead{selected.size > 1 ? "s" : ""} selectionne{selected.size > 1 ? "s" : ""}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
                      Tout deselectionner
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Transfer to manual segments */}
                    {manualSegments.filter(s => s.id !== segmentId).map(target => (
                      <Button
                        key={target.id}
                        size="sm"
                        variant="outline"
                        onClick={() => handleTransfer(target.id)}
                        disabled={transferring}
                        className="gap-1.5"
                      >
                        {transferring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                        {target.label}
                      </Button>
                    ))}
                    {/* Remove from manual segment */}
                    {currentSegment?.type === "manual" && (
                      <Button size="sm" variant="destructive" onClick={handleRemove} disabled={removing} className="gap-1.5">
                        {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Retirer
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-10">
                        <Checkbox checked={visibleAllSelected ?? false} onCheckedChange={toggleSelectAll} />
                      </TableHead>
                      {isColdcall ? (
                        <>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("nom_entreprise")}>
                            Entreprise <SortIcon col="nom_entreprise" />
                          </TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("ville")}>
                            Loc. <SortIcon col="ville" />
                          </TableHead>
                          <TableHead className="w-24 cursor-pointer text-right" onClick={() => toggleSort("effectifs")}>
                            Eff. <SortIcon col="effectifs" />
                          </TableHead>
                          <TableHead className="w-24 cursor-pointer text-right" onClick={() => toggleSort("ca")}>
                            CA <SortIcon col="ca" />
                          </TableHead>
                          <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("tech_score")}>
                            Dette <SortIcon col="tech_score" />
                          </TableHead>
                          <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("copyright_year")}>
                            Tech <SortIcon col="copyright_year" />
                          </TableHead>
                          <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("outreach_status")}>
                            Status <SortIcon col="outreach_status" />
                          </TableHead>
                          <TableHead className="w-[200px] text-center">Actions</TableHead>
                        </>
                      ) : isClaude ? (
                        <>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("nom_entreprise")}>
                            Entreprise <SortIcon col="nom_entreprise" />
                          </TableHead>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("ville")}>
                            Localisation <SortIcon col="ville" />
                          </TableHead>
                          <TableHead className="w-24 text-center cursor-pointer" onClick={() => toggleSort("qualification")}>
                            Score /10 <SortIcon col="qualification" />
                          </TableHead>
                          <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("claude_activity_count")}>
                            Activites <SortIcon col="claude_activity_count" />
                          </TableHead>
                          <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("outreach_status")}>
                            Status <SortIcon col="outreach_status" />
                          </TableHead>
                          <TableHead className="w-32">Dernier draft</TableHead>
                          <TableHead className="w-32 cursor-pointer" onClick={() => toggleSort("contacted_date")}>
                            Dernier contact <SortIcon col="contacted_date" />
                          </TableHead>
                        </>
                      ) : isPj ? (
                        <>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("nom_entreprise")}>
                            Entreprise <SortIcon col="nom_entreprise" />
                          </TableHead>
                          <TableHead>Activite PJ</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("ville")}>
                            Loc. <SortIcon col="ville" />
                          </TableHead>
                          <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("nb_avis_pj")}>
                            Avis <SortIcon col="nb_avis_pj" />
                          </TableHead>
                          <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("honeypot_score")}>
                            Piege <SortIcon col="honeypot_score" />
                          </TableHead>
                          <TableHead className="w-32 text-center cursor-pointer" onClick={() => toggleSort("solocal_tier")}>Site / Solocal <SortIcon col="solocal_tier" /></TableHead>
                          <TableHead className="w-24 cursor-pointer text-right" onClick={() => toggleSort("effectifs")}>
                            Eff. <SortIcon col="effectifs" />
                          </TableHead>
                          <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("outreach_status")}>
                            Status <SortIcon col="outreach_status" />
                          </TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="w-[180px] cursor-pointer" onClick={() => toggleSort("domain")}>
                            Domaine <SortIcon col="domain" />
                          </TableHead>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("nom_entreprise")}>
                            Entreprise <SortIcon col="nom_entreprise" />
                          </TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => toggleSort("ville")}>
                            Loc. <SortIcon col="ville" />
                          </TableHead>
                          <TableHead className="w-24 cursor-pointer text-right" onClick={() => toggleSort("effectifs")}>
                            Eff. <SortIcon col="effectifs" />
                          </TableHead>
                          <TableHead className="w-24 cursor-pointer text-right" onClick={() => toggleSort("ca")}>
                            CA <SortIcon col="ca" />
                          </TableHead>
                          <TableHead className="w-20 text-center cursor-pointer" onClick={() => toggleSort("tech_score")}>
                            Dette <SortIcon col="tech_score" />
                          </TableHead>
                          <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("copyright_year")}>
                            Tech <SortIcon col="copyright_year" />
                          </TableHead>
                          <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("outreach_status")}>
                            Status <SortIcon col="outreach_status" />
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: isColdcall ? 10 : isClaude ? 8 : isPj ? 10 : 10 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {!loading && data?.data.map((lead) => (
                      <TableRow
                        key={lead.domain}
                        className={`cursor-pointer hover:bg-muted/30 transition-colors ${selected.has(lead.domain) ? "bg-primary/5" : ""}`}
                        onClick={() => setSelectedDomain(isPj && lead.pj_id ? lead.pj_id : lead.domain)}
                      >
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox checked={selected.has(lead.domain)} onCheckedChange={() => toggleSelect(lead.domain)} />
                        </TableCell>
                        {isColdcall ? (
                          <>
                            {/* Entreprise + dirigeant */}
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold">{lead.nom_entreprise || "-"}</span>
                                <span className="text-xs text-muted-foreground">
                                  {lead.web_domain ?? <span className="font-mono">SIREN {lead.domain}</span>}
                                </span>
                                {lead.dirigeant && lead.dirigeant.trim() !== "" && (
                                  <span className="text-xs text-blue-600">{lead.dirigeant}{lead.age_dirigeant ? ` (${lead.age_dirigeant} ans)` : ""} {lead.qualite_dirigeant ? `— ${lead.qualite_dirigeant}` : ""}</span>
                                )}
                              </div>
                            </TableCell>
                            {/* Contact (phone + email) */}
                            <TableCell>
                              <div className="flex flex-col gap-0.5 text-xs">
                                {lead.phone && (
                                  <div className="flex items-center gap-1.5 font-medium text-emerald-700">
                                    <Phone className="h-3 w-3" /> {lead.phone}
                                  </div>
                                )}
                                {(lead.email || lead.dirigeant_email) && (
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate max-w-[140px]">{lead.dirigeant_email || lead.email}</span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            {/* Localisation */}
                            <TableCell className="text-sm text-muted-foreground">
                              {lead.ville && <div>{lead.ville}</div>}
                              {lead.departement && <div className="text-xs font-mono">({lead.departement})</div>}
                            </TableCell>
                            {/* Effectifs */}
                            <TableCell className="text-right text-sm">
                              {formatEffectifs(lead.effectifs) !== "-" ? (
                                <Badge variant="outline" className="font-normal">{formatEffectifs(lead.effectifs)}</Badge>
                              ) : "-"}
                            </TableCell>
                            {/* CA */}
                            <TableCell className="text-right text-sm font-mono text-muted-foreground">
                              {formatCA(lead.ca)}
                            </TableCell>
                            {/* Tech Score */}
                            <TableCell className="text-center">
                              <TechScoreBadge score={lead.tech_score} />
                            </TableCell>
                            {/* Tech indicators */}
                            <TableCell>
                              <div className="flex justify-center gap-1">
                                {lead.has_responsive === 0 && <span title="Non responsive"><AlertTriangle className="h-4 w-4 text-orange-500" /></span>}
                                {lead.has_https === 0 && <span title="Pas HTTPS"><Lock className="h-4 w-4 text-red-500" /></span>}
                                {lead.cms && (
                                  <Badge variant="secondary" className="text-[10px] h-5 px-1">{lead.cms}</Badge>
                                )}
                              </div>
                            </TableCell>
                            {/* Status */}
                            <TableCell className="text-center">
                              <StatusBadge status={lead.outreach_status} />
                            </TableCell>
                            {/* Quick action buttons */}
                            <TableCell onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                {lead.outreach_status !== "appele" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 gap-1 text-xs bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
                                    onClick={(e) => handleQuickStatus(lead.domain, "appele", e)}
                                    title="Marquer comme appele"
                                  >
                                    <PhoneOff className="h-3 w-3" /> Appele
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 gap-1 text-xs bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                                    onClick={(e) => handleQuickStatus(lead.domain, "a_contacter", e)}
                                    title="Remettre a contacter"
                                  >
                                    <PhoneCall className="h-3 w-3" /> Retour
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 gap-1 text-xs hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200"
                                  onClick={(e) => handleQuickStatus(lead.domain, "rappeler", e)}
                                  title="A rappeler"
                                >
                                  <PhoneForwarded className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 gap-1 text-xs hover:bg-green-50 hover:text-green-700 hover:border-green-200"
                                  onClick={(e) => handleQuickStatus(lead.domain, "interesse", e)}
                                  title="Interesse"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 gap-1 text-xs hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200"
                                  onClick={(e) => handleQuickStatus(lead.domain, "rdv", e)}
                                  title="RDV"
                                >
                                  <CalendarClock className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 gap-1 text-xs hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                                  onClick={(e) => handleQuickStatus(lead.domain, "pas_interesse", e)}
                                  title="Pas interesse"
                                >
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        ) : isClaude ? (
                          <>
                            {/* Entreprise */}
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold">{lead.nom_entreprise || "-"}</span>
                                <span className="text-xs text-muted-foreground">
                                  {lead.web_domain ?? <span className="font-mono">SIREN {lead.domain}</span>}
                                </span>
                              </div>
                            </TableCell>
                            {/* Localisation */}
                            <TableCell className="text-sm">
                              {lead.ville && <div>{lead.ville}</div>}
                              {lead.departement && <div className="text-xs font-mono text-muted-foreground">({lead.departement})</div>}
                            </TableCell>
                            {/* Score qualification */}
                            <TableCell className="text-center">
                              <QualificationScoreBadge score={lead.qualification ?? 0} />
                            </TableCell>
                            {/* Nb activités Claude */}
                            <TableCell className="text-center">
                              <Badge variant="secondary" className="text-xs">
                                {lead.claude_activity_count ?? 0}
                              </Badge>
                            </TableCell>
                            {/* Status */}
                            <TableCell className="text-center">
                              <StatusBadge status={lead.outreach_status} />
                            </TableCell>
                            {/* Dernier draft */}
                            <TableCell>
                              {(lead as unknown as { last_draft_date?: string }).last_draft_date ? (
                                <span className="text-xs text-muted-foreground">
                                  {formatTimeAgo((lead as unknown as { last_draft_date?: string }).last_draft_date!)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            {/* Dernier contact */}
                            <TableCell>
                              {lead.contacted_date ? (
                                <span className="text-xs text-muted-foreground">
                                  {formatTimeAgo(lead.contacted_date)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          </>
                        ) : isPj ? (
                          <>
                            {/* Entreprise + dirigeant */}
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold">{lead.nom_entreprise || "-"}</span>
                                <span className="text-xs text-muted-foreground">{lead.dirigeant || ""}</span>
                                {lead.pj_url && (
                                  <a href={lead.pj_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-[10px] text-yellow-700 hover:underline inline-flex items-center gap-0.5 mt-0.5">
                                    <ExternalLink className="h-2.5 w-2.5" /> Pages Jaunes
                                  </a>
                                )}
                              </div>
                            </TableCell>
                            {/* Activite PJ */}
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                {lead.activites_pj?.split(",").slice(0, 2).map((a, i) => (
                                  <Badge key={i} variant="secondary" className="text-[10px] h-5 px-1.5 w-fit">{a.replace(/-$/, "").trim()}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            {/* Contact */}
                            <TableCell>
                              <div className="flex flex-col gap-0.5 text-xs">
                                {lead.phone && (
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Phone className="h-3 w-3" /> {lead.phone}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            {/* Localisation */}
                            <TableCell className="text-sm text-muted-foreground">
                              {lead.ville && <div>{lead.ville}</div>}
                              {lead.departement && <div className="text-xs font-mono">({lead.departement})</div>}
                            </TableCell>
                            {/* Avis PJ */}
                            <TableCell className="text-center">
                              {lead.nb_avis_pj != null && lead.nb_avis_pj > 0 ? (
                                <div className="flex flex-col items-center">
                                  <div className="flex items-center gap-0.5">
                                    <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                                    <span className="text-sm font-medium">{lead.rating_pj || "-"}</span>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground">{lead.nb_avis_pj} avis</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            {/* Honeypot */}
                            <TableCell className="text-center">
                              <HoneypotBadge score={lead.honeypot_score} flag={lead.honeypot_flag} reasons={lead.honeypot_reasons} />
                            </TableCell>
                            {/* Site web + tier Solocal */}
                            <TableCell className="text-center">
                              {lead.pj_website_url ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <a href={lead.pj_website_url.startsWith("http") ? lead.pj_website_url : `https://${lead.pj_website_url}`} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
                                    <Globe className="h-3 w-3" /> Site
                                  </a>
                                  {lead.is_solocal === 1 && (
                                    <Badge className="text-[10px] h-4 px-1 bg-orange-100 text-orange-800 border-orange-200">
                                      {lead.solocal_tier === "ESSENTIEL" ? "Essentiel ~80€" :
                                       lead.solocal_tier === "PREMIUM" ? "Premium ~200€" :
                                       lead.solocal_tier === "PERFORMANCE" ? "Perf ~220€" :
                                       lead.solocal_tier === "PRIVILEGE" ? "Privilège ~355€" :
                                       "Solocal"}
                                    </Badge>
                                  )}
                                  {lead.is_solocal === 0 && (
                                    <Badge className="text-[10px] h-4 px-1 bg-green-50 text-green-700 border-green-200">Externe</Badge>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-red-200 text-red-600">Pas de site</Badge>
                              )}
                            </TableCell>
                            {/* Effectifs */}
                            <TableCell className="text-right text-sm">
                              {formatEffectifs(lead.effectifs) !== "-" ? (
                                <Badge variant="outline" className="font-normal">{formatEffectifs(lead.effectifs)}</Badge>
                              ) : "-"}
                            </TableCell>
                            {/* Status */}
                            <TableCell className="text-center">
                              <StatusBadge status={lead.outreach_status} />
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                  {lead.web_domain ? (
                                    <span className="text-sm font-semibold text-primary">{lead.web_domain}</span>
                                  ) : (
                                    <span className="text-sm font-semibold text-primary font-mono text-xs">SIREN {lead.domain}</span>
                                  )}
                                  {lead.last_visited && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 whitespace-nowrap inline-flex items-center gap-0.5">
                                      <Eye className="h-3 w-3" />
                                      {formatTimeAgo(lead.last_visited)}
                                    </span>
                                  )}
                                  {(lead.claude_activity_count ?? 0) > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 whitespace-nowrap inline-flex items-center gap-0.5" title={`${lead.claude_activity_count} note(s) Claude`}>
                                      <Bot className="h-3 w-3" />
                                      {lead.claude_activity_count}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground truncate max-w-[150px]">{lead.nom_entreprise || "-"}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col text-sm">
                                <span>{lead.dirigeant || "-"}{lead.age_dirigeant ? <span className="ml-1 text-xs text-muted-foreground">({lead.age_dirigeant} ans)</span> : null}</span>
                                <span className="text-xs text-muted-foreground">{lead.qualite_dirigeant || ""}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5 text-xs">
                                {lead.phone && (
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Phone className="h-3 w-3" /> {lead.phone}
                                  </div>
                                )}
                                {(lead.email || lead.dirigeant_email) && (
                                  <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate max-w-[140px]">{lead.dirigeant_email || lead.email}</span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {lead.ville && <div>{lead.ville}</div>}
                              {lead.departement && <div className="text-xs font-mono">({lead.departement})</div>}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {formatEffectifs(lead.effectifs) !== "-" ? (
                                <Badge variant="outline" className="font-normal">{formatEffectifs(lead.effectifs)}</Badge>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono text-muted-foreground">
                              {formatCA(lead.ca)}
                            </TableCell>
                            <TableCell className="text-center">
                              <TechScoreBadge score={lead.tech_score} />
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-center gap-1">
                                {lead.has_responsive === 0 && <AlertTriangle className="h-4 w-4 text-orange-500" />}
                                {lead.has_https === 0 && <Lock className="h-4 w-4 text-red-500" />}
                                {lead.cms && (
                                  <Badge variant="secondary" className="text-[10px] h-5 px-1">{lead.cms}</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <StatusBadge status={lead.outreach_status} />
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                    {!loading && data?.data.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isColdcall ? 10 : isClaude ? 8 : isPj ? 10 : 10} className="text-center py-12">
                          <div className="flex flex-col items-center gap-3 text-muted-foreground">
                            <ClipboardList className="h-8 w-8 opacity-20" />
                            <p className="font-medium">Aucun prospect dans ce segment</p>
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

              <LeadSheet domain={selectedDomain} onClose={() => setSelectedDomain(null)} onUpdated={() => { setSelectedDomain(null); fetchData(); }} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SegmentTreeItem({ segment, subItems, currentId }: {
  segment: SegmentInfo;
  subItems: SegmentInfo[];
  currentId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const isActive = currentId === segment.id;
  const hasChildren = subItems.length > 0;

  return (
    <div>
      <div className="flex items-center">
        {hasChildren && (
          <button className="p-0.5 mr-0.5 hover:bg-muted rounded" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronR className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        )}
        {!hasChildren && <span className="w-5" />}
        <Link
          href={`/segments/${segment.id}`}
          className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
            isActive
              ? "bg-indigo-50 text-indigo-700 font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <SegmentIcon name={segment.icon} />
          <span className="truncate flex-1">{segment.label}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{segment.count.toLocaleString()}</span>
        </Link>
      </div>
      {hasChildren && open && (
        <div className="ml-5 border-l pl-1 space-y-0.5 mt-0.5">
          {subItems.map(child => (
            <Link
              key={child.id}
              href={`/segments/${child.id}`}
              className={`flex items-center gap-2 px-2 py-1 rounded-md text-sm transition-colors ${
                currentId === child.id
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <SegmentIcon name={child.icon} />
              <span className="truncate flex-1">{child.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{child.count.toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
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

function HoneypotBadge({ score, flag, reasons }: { score?: number | null; flag?: string | null; reasons?: string | null }) {
  if (!flag) return <span className="text-xs text-muted-foreground">-</span>;

  let parsed: string[] = [];
  try { parsed = reasons ? JSON.parse(reasons) : []; } catch { /* ignore */ }
  const tooltip = parsed.join(", ");

  if (flag === "PROBABLE") {
    return (
      <span title={tooltip} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300 cursor-help">
        <AlertTriangle className="h-3 w-3" /> {score}
      </span>
    );
  }
  if (flag === "SUSPECT") {
    return (
      <span title={tooltip} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700 border border-orange-200 cursor-help">
        {score}
      </span>
    );
  }
  // POSSIBLE
  return (
    <span title={tooltip} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 cursor-help">
      {score}
    </span>
  );
}

function QualificationScoreBadge({ score }: { score: number }) {
  if (score == null || score === 0) return <span className="text-xs text-muted-foreground">-</span>;
  let color = "bg-gray-100 text-gray-700";
  if (score >= 7) color = "bg-green-100 text-green-800 border-green-300";
  else if (score >= 4) color = "bg-orange-100 text-orange-800 border-orange-300";
  else if (score > 0) color = "bg-red-100 text-red-800 border-red-300";
  return (
    <span className={`inline-flex items-center justify-center h-6 min-w-[2.5rem] px-1.5 rounded-md text-xs font-bold border ${color}`}>
      {score}/10
    </span>
  );
}
