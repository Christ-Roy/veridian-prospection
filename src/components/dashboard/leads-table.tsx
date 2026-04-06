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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./status-badge";
import { LeadSheet } from "./lead-sheet";
import { AdvancedFilters } from "./advanced-filters";
import { formatCA, formatEffectifs, formatTimeAgo } from "@/lib/types";
import { NAF_LABELS } from "@/lib/naf";
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
  X,
  Filter,
  Phone,
  Mail,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Layers,
  Upload,
  Loader2,
  ClipboardList,
} from "lucide-react";

interface LeadsResponse {
  data: Lead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 50;

export function LeadsTable() {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("domain");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [deduplicate, setDeduplicate] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: PAGE_SIZE.toString(),
      sort,
      sortDir,
      deduplicate: deduplicate.toString(),
    });

    for (const [k, v] of Object.entries(filters)) {
      if (v) {
        params.set(`f_${k}`, v);
      }
    }

    const res = await fetch(`/api/leads?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, sort, sortDir, filters, deduplicate]);

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

  function setFilter(key: string, value: string) {
    setFilters((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(1);
  }

  function clearFilters() {
    setFilters({});
    setDeduplicate(false);
    setSearchInput("");
    setPage(1);
  }

  function handleSearch() {
    if (searchInput) {
      setFilter("search", searchInput);
    } else {
      setFilter("search", "");
    }
  }

  // --- Selection ---

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

  // --- Export Twenty CRM ---

  async function handleExport() {
    if (selected.size === 0) return;
    setExporting(true);
    const toastId = toast.loading(`Export de ${selected.size} lead(s) vers Twenty CRM...`);

    try {
      const res = await fetch("/api/twenty/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: Array.from(selected) }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Erreur lors de l'export", { id: toastId });
        return;
      }

      const parts: string[] = [];
      if (result.companies.created > 0) parts.push(`${result.companies.created} entreprise(s)`);
      if (result.people.created > 0) parts.push(`${result.people.created} dirigeant(s)`);
      if (result.notes?.created > 0) parts.push(`${result.notes.created} note(s)`);

      const errors = [...(result.companies.errors || []), ...(result.people.errors || []), ...(result.notes?.errors || [])];

      if (parts.length > 0) {
        toast.success(`Export: ${parts.join(" + ")}`, {
          id: toastId,
          description: errors.length > 0 ? `${errors.length} erreur(s)` : undefined,
        });
      } else {
        toast.warning("Aucun lead export (erreurs)", {
          id: toastId,
          description: errors.slice(0, 3).join("\n"),
        });
      }

      setSelected(new Set());
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    } finally {
      setExporting(false);
    }
  }

  // --- Add to Audit segment ---

  async function handleAddToAudit() {
    if (selected.size === 0) return;
    const toastId = toast.loading(`Ajout de ${selected.size} lead(s) au segment Audit...`);
    try {
      const res = await fetch("/api/segments/69/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: Array.from(selected) }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(`${result.added} lead(s) ajoute(s) au segment Audit`, { id: toastId });
        setSelected(new Set());
      } else {
        toast.error(result.error || "Erreur", { id: toastId });
      }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sort !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  }

  const isFilterActive = (key: string, value: string) => filters[key] === value;

  const quickFilters = [
    { label: "Enrichis", icon: CheckCircle2, key: "enriched_via", value: "!empty", color: "text-green-600" },
    { label: "Avec tel", icon: Phone, key: "phone", value: "!empty", color: "text-blue-600" },
    { label: "Mobile", icon: Smartphone, key: "phone_type", value: "=mobile", color: "text-purple-600" },
    { label: "Email Dirigeant", icon: Mail, key: "dirigeant_email", value: "!empty", color: "text-orange-600" },
    { label: "Non consultés", icon: X, key: "last_visited", value: "empty", color: "text-gray-500" },
  ];

  const activeFilterCount = Object.keys(filters).length + (deduplicate ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex flex-1 items-center gap-2 w-full">
          <div className="relative flex-1 max-w-sm">
             <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
             <Input
               placeholder="Rechercher (domaine, tel, email, nom...)"
               value={searchInput}
               onChange={(e) => setSearchInput(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && handleSearch()}
               className="pl-9 h-9"
             />
          </div>
          <Button size="sm" onClick={handleSearch} className="h-9">
            Rechercher
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
           {quickFilters.map((qf) => (
             <Button
               key={qf.label}
               variant={isFilterActive(qf.key, qf.value) ? "secondary" : "ghost"}
               size="sm"
               className={`h-8 border ${isFilterActive(qf.key, qf.value) ? "border-primary/20 bg-primary/5" : "border-transparent"}`}
               onClick={() => setFilter(qf.key, isFilterActive(qf.key, qf.value) ? "" : qf.value)}
             >
               <qf.icon className={`h-3.5 w-3.5 mr-2 ${qf.color}`} />
               {qf.label}
             </Button>
           ))}

           <div className="h-8 w-px bg-border mx-1" />

           <AdvancedFilters
             filters={filters}
             setFilters={(f) => { setFilters(f); setPage(1); }}
             deduplicate={deduplicate}
             setDeduplicate={(d) => { setDeduplicate(d); setPage(1); }}
           />

           {activeFilterCount > 0 && (
             <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-muted-foreground hover:text-destructive">
               <X className="h-3.5 w-3.5 mr-1" />
             </Button>
           )}
        </div>
      </div>

      {/* Active Filters Summary */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 items-center px-1">
           <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Filtres actifs:</span>
           {deduplicate && (
             <Badge variant="outline" className="bg-white gap-1">
               <Layers className="h-3 w-3" /> Groupe par entreprise
               <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => setDeduplicate(false)} />
             </Badge>
           )}
           {Object.entries(filters).map(([key, value]) => {
              if (!value) return null;
              const labelMap: Record<string, string> = {
                search: "Recherche", domain: "Domaine", effectifs: "Effectifs", phone: "Tel", phone_type: "Type tel",
                dirigeant_email: "Email dir.", enriched_via: "Enrichi", has_responsive: "Responsive",
                has_https: "HTTPS", has_old_html: "Vieux HTML", cms: "CMS", platform_name: "Plateforme",
                outreach_status: "Statut", categorie: "Categorie", forme_juridique: "Forme jur.",
                departement: "Dept", ca_range: "CA", copyright_max: "Copyright", api_etat: "Etat",
                code_naf: "Secteur", siret: "SIRET", siren: "SIREN", tva_intracom: "TVA",
                rcs: "RCS", email_principal: "Email", social_linkedin: "LinkedIn",
                social_facebook: "Facebook", social_instagram: "Instagram", social_twitter: "Twitter",
                social_youtube: "YouTube", has_contact_form: "Form.", has_chat_widget: "Chat",
                has_whatsapp: "WhatsApp", has_flash: "Flash", has_layout_tables: "Tables",
                has_ie_polyfills: "IE", has_lorem_ipsum: "Lorem", has_phpsessid: "PHPSESSID",
                has_mixed_content: "Mixed", has_old_images: "Vieilles img", has_viewport_no_scale: "No-scale",
                has_meta_keywords: "Meta kw", has_favicon: "Favicon", has_modern_images: "WebP",
                has_minified_assets: "Minifie", has_compression: "Gzip", has_cdn: "CDN",
                has_lazy_loading: "Lazy", has_security_headers: "Sec. headers", has_noindex: "Noindex",
                has_canonical: "Canonical", has_hreflang: "Hreflang", has_schema_org: "Schema",
                has_og_tags: "OG", language: "Langue", analytics_type: "Analytics",
                has_facebook_pixel: "FB Pixel", has_linkedin_pixel: "LI Pixel", has_google_ads: "AdSense",
                has_cookie_banner: "Cookies", cookie_banner_name: "Cookie ban.", has_devis: "Devis",
                has_ecommerce: "E-comm.", has_blog: "Blog", has_recruiting_page: "Recrut.",
                has_google_maps: "Maps", has_horaires: "Horaires", has_booking_system: "Resa",
                has_newsletter_provider: "Newsletter", has_certifications: "Certif.", has_app_links: "App",
                has_trust_signals: "Avis", has_mentions_legales: "Mentions leg.", enriched: "Enrichi",
                api_est_asso: "Asso", api_est_ess: "ESS", api_est_service_public: "Serv. pub.",
                api_est_qualiopi: "Qualiopi", api_est_rge: "RGE", api_est_societe_mission: "Soc. mission",
                bodacc_procedure: "BODACC", phone_valid: "Tel valide", phone_shared: "Tel partage",
                phone_test: "N test", page_builder_name: "Page builder", js_framework_name: "JS Fw",
                css_framework_name: "CSS Fw", jquery_version: "jQuery", bootstrap_version: "Bootstrap",
                agency_signature: "Agence", php_version: "PHP", powered_by: "Powered By",
              };
              let displayValue = value.replace("!empty", "Oui").replace(/^=/, "");
              if (key === "has_responsive" && value === "=0") displayValue = "Non";
              if (key === "has_https" && value === "=0") displayValue = "Non";
              if (key === "has_old_html" && value === "=1") displayValue = "Oui";
              const caLabels: Record<string, string> = {
                "0-100000": "< 100K",
                "100000-500000": "100K-500K",
                "500000-2000000": "500K-2M",
                "2000000-10000000": "2-10M",
                ">=10000000": "> 10M",
              };
              if (key === "ca_range") displayValue = caLabels[value] || value;
              if (key === "copyright_max") displayValue = value;
              if (key === "code_naf") displayValue = value.split(",").map(c => NAF_LABELS[c.trim()] || c.trim()).join(", ");

              return (
                <Badge key={key} variant="secondary" className="bg-white border gap-1 text-xs">
                  <span className="font-semibold">{labelMap[key] || key}:</span> {displayValue}
                  <X className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive" onClick={() => setFilter(key, "")} />
                </Badge>
              )
           })}
        </div>
      )}

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
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
            variant="outline"
            onClick={handleAddToAudit}
            className="gap-2"
          >
            <ClipboardList className="h-4 w-4" />
            Audit
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="gap-2"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Exporter vers Twenty CRM
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: 10 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 9 }).map((_, j) => (
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
                    <div className="flex items-center gap-1.5">
                      {lead.web_domain ? (
                        <a
                          href={`https://${lead.web_domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-semibold text-primary hover:underline"
                        >
                          {lead.web_domain}
                        </a>
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground italic">sans site web</span>
                      )}
                      {lead.last_visited && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 whitespace-nowrap">
                          {formatTimeAgo(lead.last_visited)}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{lead.nom_entreprise || lead.denomination || `SIREN ${lead.domain}`}</span>
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
                     {lead.has_responsive === 0 && (
                       <div className="group relative">
                          <AlertTriangle className="h-4 w-4 text-orange-500" />
                          <span className="sr-only">Non responsive</span>
                       </div>
                     )}
                     {lead.has_https === 0 && (
                       <div className="group relative">
                          <Lock className="h-4 w-4 text-red-500" />
                          <span className="sr-only">Non securise</span>
                       </div>
                     )}
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
              </TableRow>
            ))}
            {!loading && data?.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <Filter className="h-6 w-6 opacity-20" />
                    </div>
                    <p className="font-medium">Aucun resultat trouve</p>
                    <p className="text-sm max-w-xs">Essayez d&apos;ajuster vos filtres pour voir plus de resultats.</p>
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Reinitialiser les filtres
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between px-2">
          <p className="text-xs text-muted-foreground">
            Affichage de <strong>{(data.page - 1) * data.pageSize + 1}-{Math.min(data.page * data.pageSize, data.total)}</strong> sur <strong>{data.total.toLocaleString()}</strong> leads
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
