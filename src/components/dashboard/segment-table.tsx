"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./status-badge";
import { LeadSheet } from "./lead-sheet";
import { formatCA, formatEffectifs } from "@/lib/types";
import { toast } from "sonner";
import type { Lead } from "@/lib/types";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Phone,
  Mail,
  AlertTriangle,
  Lock,
  Trash2,
  Loader2,
  ClipboardList,
} from "lucide-react";

interface SegmentLead extends Lead {
  segment_added_at: string;
  segment_notes: string | null;
}

interface SegmentResponse {
  data: SegmentLead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 50;

interface SegmentTableProps {
  segment: string;
}

export function SegmentTable({ segment }: SegmentTableProps) {
  const [data, setData] = useState<SegmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("added_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: PAGE_SIZE.toString(),
      sort,
      sortDir,
    });

    const res = await fetch(`/api/segments/${segment}?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, sort, sortDir, segment]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function toggleSort(col: string) {
    if (sort === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleSelect(domain: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!data) return;
    const visible = data.data.map((l) => l.domain);
    const allSelected = visible.every((d) => selected.has(d));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visible.forEach((d) => next.delete(d));
      } else {
        visible.forEach((d) => next.add(d));
      }
      return next;
    });
  }

  const visibleAllSelected =
    data && data.data.length > 0 && data.data.every((l) => selected.has(l.domain));

  async function handleRemove() {
    if (selected.size === 0) return;
    setRemoving(true);
    const toastId = toast.loading(`Retrait de ${selected.size} lead(s)...`);
    try {
      const res = await fetch(`/api/segments/${segment}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: Array.from(selected) }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(`${result.removed} lead(s) retire(s) du segment`, { id: toastId });
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

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-indigo-600" />
          <span className="text-sm font-medium">
            {data ? <strong>{data.total.toLocaleString()}</strong> : "..."} prospect{data && data.total !== 1 ? "s" : ""} dans ce segment
          </span>
        </div>
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selected.size} lead{selected.size > 1 ? "s" : ""} selectionne{selected.size > 1 ? "s" : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => setSelected(new Set())}
            >
              Tout deselectionner
            </Button>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleRemove}
            disabled={removing}
            className="gap-2"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Retirer du segment
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10">
                <Checkbox
                  checked={visibleAllSelected ?? false}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
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
              <TableHead className="w-28 text-center cursor-pointer" onClick={() => toggleSort("copyright_year")}>
                Tech <SortIcon col="copyright_year" />
              </TableHead>
              <TableHead className="w-32 text-center cursor-pointer" onClick={() => toggleSort("outreach_status")}>
                Status <SortIcon col="outreach_status" />
              </TableHead>
              <TableHead className="w-28 cursor-pointer" onClick={() => toggleSort("added_at")}>
                Ajout <SortIcon col="added_at" />
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
            {!loading && data?.data.map((lead) => (
              <TableRow
                key={lead.domain}
                className={`cursor-pointer hover:bg-muted/30 transition-colors ${selected.has(lead.domain) ? "bg-primary/5" : ""}`}
                onClick={() => setSelectedDomain(lead.domain)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(lead.domain)}
                    onCheckedChange={() => toggleSelect(lead.domain)}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    {lead.web_domain ? (
                      <span className="text-sm font-semibold text-primary">{lead.web_domain}</span>
                    ) : (
                      <span className="text-sm font-semibold text-primary font-mono text-xs">SIREN {lead.domain}</span>
                    )}
                    <span className="text-xs text-muted-foreground truncate max-w-[150px]">{lead.nom_entreprise || "-"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col text-sm">
                    <span>{lead.dirigeant || "-"}</span>
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
                    <Badge variant="outline" className="font-normal">
                      {formatEffectifs(lead.effectifs)}
                    </Badge>
                  ) : "-"}
                </TableCell>
                <TableCell className="text-right text-sm font-mono text-muted-foreground">
                  {formatCA(lead.ca)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    {lead.has_responsive === 0 && <AlertTriangle className="h-4 w-4 text-orange-500" />}
                    {lead.has_https === 0 && <Lock className="h-4 w-4 text-red-500" />}
                    {lead.cms && (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1">
                        {lead.cms}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <StatusBadge status={lead.outreach_status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {lead.segment_added_at ? new Date(lead.segment_added_at).toLocaleDateString("fr-FR") : "-"}
                </TableCell>
              </TableRow>
            ))}
            {!loading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <ClipboardList className="h-6 w-6 opacity-20" />
                    </div>
                    <p className="font-medium">Aucun prospect dans ce segment</p>
                    <p className="text-sm max-w-xs">Ajoutez des prospects depuis le dashboard principal.</p>
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
            Affichage de <strong>{(data.page - 1) * data.pageSize + 1}-{Math.min(data.page * data.pageSize, data.total)}</strong> sur <strong>{data.total.toLocaleString()}</strong>
          </p>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)} className="h-8 w-8 p-0">
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(data.totalPages)} className="h-8 w-8 p-0">
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <LeadSheet
        domain={selectedDomain}
        onClose={() => setSelectedDomain(null)}
        onUpdated={() => {
          setSelectedDomain(null);
          fetchData();
        }}
      />
    </div>
  );
}
