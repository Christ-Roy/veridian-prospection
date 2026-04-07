"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { LeadSheet } from "./lead-sheet";
import { formatTimeAgo } from "@/lib/types";
import { toast } from "sonner";
import {
  Phone,
  Mail,
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  MessageSquare,
  Clock,
  RefreshCw,
  GripHorizontal,
} from "lucide-react";

interface PipelineLead {
  domain: string;
  siren?: string;
  web_domain?: string | null;
  nom_entreprise: string;
  dirigeant: string;
  phone: string | null;
  email: string | null;
  dirigeant_email: string | null;
  ville: string | null;
  departement: string | null;
  outreach_status: string;
  outreach_notes: string | null;
  contacted_date: string | null;
  contact_method: string | null;
  qualification: number | null;
  last_visited: string | null;
  ca: number | null;
  effectifs: string | null;
  cms: string | null;
  email_count: number;
  pending_followups: number;
}

const ALL_COLUMNS = [
  { id: "fiche_ouverte", label: "Fiche ouverte", color: "bg-indigo-500" },
  { id: "appele", label: "Appele", color: "bg-sky-500" },
  { id: "interesse", label: "Interesse", color: "bg-green-500" },
  { id: "rappeler", label: "A rappeler", color: "bg-orange-500" },
  { id: "rdv", label: "RDV", color: "bg-purple-500" },
  { id: "client", label: "Client", color: "bg-yellow-500" },
  { id: "pas_interesse", label: "Pas interesse", color: "bg-red-400" },
  { id: "hors_cible", label: "Hors cible", color: "bg-gray-400" },
];

const MINOR_STATUSES = ["en_observation", "non_qualifie", "skip", "skip_qualifie", "rejete", "a_ignorer", "non_pertinent", "email_invalide", "en_attente"];

export function PipelineBoard() {
  const [pipeline, setPipeline] = useState<Record<string, PipelineLead[]>>({});
  const [columnOrder, setColumnOrder] = useState<string[]>(ALL_COLUMNS.map(c => c.id));
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [emailModal, setEmailModal] = useState<string | null>(null);
  const [showMinor, setShowMinor] = useState(false);

  // Drag state — unified for cards AND columns
  const [dragType, setDragType] = useState<"card" | "column" | null>(null);
  const [dragCardSource, setDragCardSource] = useState<{ domain: string; column: string } | null>(null);
  const [dragColumnId, setDragColumnId] = useState<string | null>(null);
  const [dropCardTarget, setDropCardTarget] = useState<{ column: string; index: number } | null>(null);
  const [dropColumnTarget, setDropColumnTarget] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline");
      const data = await res.json();
      setPipeline(data.pipeline);
      if (data.columnOrder && Array.isArray(data.columnOrder)) {
        // Merge: keep saved order, append any new columns
        const saved = data.columnOrder as string[];
        const allIds = ALL_COLUMNS.map(c => c.id);
        const merged = [...saved.filter((id: string) => allIds.includes(id)), ...allIds.filter(id => !saved.includes(id))];
        setColumnOrder(merged);
      }
    } catch {
      toast.error("Erreur chargement pipeline");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  // --- Column drag ---

  function handleColumnDragStart(e: React.DragEvent, colId: string) {
    setDragType("column");
    setDragColumnId(colId);
    e.dataTransfer.setData("text/plain", `col:${colId}`);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleColumnDragOver(e: React.DragEvent, colId: string) {
    if (dragType !== "column") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropColumnTarget(colId);
  }

  async function handleColumnDrop(e: React.DragEvent, targetColId: string) {
    e.preventDefault();
    if (dragType !== "column" || !dragColumnId || dragColumnId === targetColId) {
      resetDrag();
      return;
    }

    const prevOrder = [...columnOrder];
    const next = [...prevOrder];
    const fromIdx = next.indexOf(dragColumnId!);
    const toIdx = next.indexOf(targetColId);
    if (fromIdx === -1 || toIdx === -1) { resetDrag(); return; }
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragColumnId!);

    // Optimistic update
    setColumnOrder(next);
    resetDrag();

    // Persist — rollback on failure
    try {
      const res = await fetch("/api/pipeline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnOrder: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setColumnOrder(prevOrder);
      toast.error("Erreur sauvegarde ordre colonnes");
    }
  }

  // --- Card drag ---

  function handleCardDragStart(e: React.DragEvent, domain: string, column: string) {
    setDragType("card");
    setDragCardSource({ domain, column });
    e.dataTransfer.setData("text/plain", `card:${domain}`);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleCardDragOverCard(e: React.DragEvent, column: string, index: number) {
    if (dragType !== "card") return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropCardTarget({ column, index });
  }

  function handleCardDragOverColumn(e: React.DragEvent, column: string) {
    if (dragType !== "card") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const leads = pipeline[column] || [];
    setDropCardTarget({ column, index: leads.length });
  }

  async function handleCardDrop(e: React.DragEvent, targetColumn: string, targetIndex: number) {
    e.preventDefault();
    e.stopPropagation();
    if (dragType !== "card" || !dragCardSource) { resetDrag(); return; }

    const { domain, column: sourceColumn } = dragCardSource;

    // Snapshot for rollback
    const prevPipeline = { ...pipeline };
    for (const k of Object.keys(prevPipeline)) {
      prevPipeline[k] = [...prevPipeline[k]];
    }

    // Compute new state
    const next = { ...pipeline };
    const sourceLeads = [...(next[sourceColumn] || [])];
    const cardIdx = sourceLeads.findIndex(l => l.domain === domain);
    if (cardIdx === -1) { resetDrag(); return; }
    const [card] = sourceLeads.splice(cardIdx, 1);
    next[sourceColumn] = sourceLeads;
    if (next[sourceColumn].length === 0) delete next[sourceColumn];

    card.outreach_status = targetColumn;
    const targetLeads = [...(next[targetColumn] || [])];
    let insertIdx = targetIndex;
    if (sourceColumn === targetColumn && cardIdx < targetIndex) insertIdx--;
    targetLeads.splice(Math.max(0, insertIdx), 0, card);
    next[targetColumn] = targetLeads;

    // Optimistic update
    setPipeline(next);
    resetDrag();

    // Persist atomically — single batch request for both columns
    try {
      const columns: { status: string; sirens: string[] }[] = [
        { status: targetColumn, sirens: next[targetColumn].map(l => l.siren).filter((s): s is string => !!s) },
      ];
      if (sourceColumn !== targetColumn && next[sourceColumn]?.length) {
        columns.push({ status: sourceColumn, sirens: next[sourceColumn].map(l => l.siren).filter((s): s is string => !!s) });
      }

      const res = await fetch("/api/pipeline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchReorder: true, columns }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Rollback on failure
      setPipeline(prevPipeline);
      toast.error("Erreur sauvegarde pipeline — changement annulé");
    }
  }

  function resetDrag() {
    setDragType(null);
    setDragCardSource(null);
    setDragColumnId(null);
    setDropCardTarget(null);
    setDropColumnTarget(null);
  }

  const minorLeads = MINOR_STATUSES.reduce((acc, s) => acc + (pipeline[s]?.length || 0), 0);
  const orderedColumns = columnOrder.map(id => ALL_COLUMNS.find(c => c.id === id)!).filter(Boolean);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Chargement du pipeline...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pipeline</h2>
          <Badge variant="outline" className="text-xs">
            {Object.values(pipeline).reduce((a, b) => a + (b?.length || 0), 0)} leads
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={fetchPipeline} className="gap-1.5 h-8">
          <RefreshCw className="h-3.5 w-3.5" /> Rafraichir
        </Button>
      </div>

      {/* Kanban */}
      <div className="flex gap-2 overflow-x-auto flex-1 pb-2">
        {orderedColumns.map(col => {
          const leads = pipeline[col.id] || [];
          const isColumnDropTarget = dragType === "column" && dropColumnTarget === col.id && dragColumnId !== col.id;
          const isCardDropColumn = dragType === "card" && dropCardTarget?.column === col.id;

          return (
            <div
              key={col.id}
              className={`flex flex-col min-w-[220px] w-[220px] rounded-lg border transition-all ${
                isColumnDropTarget ? "border-primary border-2 bg-primary/5" :
                isCardDropColumn ? "border-primary/30 bg-primary/5" :
                "bg-muted/30"
              }`}
              onDragOver={(e) => {
                handleColumnDragOver(e, col.id);
                handleCardDragOverColumn(e, col.id);
              }}
              onDrop={(e) => {
                if (dragType === "column") handleColumnDrop(e, col.id);
                else if (dragType === "card") handleCardDrop(e, col.id, leads.length);
              }}
            >
              {/* Column header — draggable */}
              <div
                draggable
                onDragStart={(e) => handleColumnDragStart(e, col.id)}
                onDragEnd={resetDrag}
                className={`flex items-center gap-2 px-2.5 py-1.5 border-b bg-white rounded-t-lg cursor-grab active:cursor-grabbing select-none ${
                  dragColumnId === col.id ? "opacity-40" : ""
                }`}
              >
                <GripHorizontal className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                <div className={`h-2 w-2 rounded-full ${col.color}`} />
                <span className="text-xs font-medium">{col.label}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-auto">
                  {leads.length}
                </Badge>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {leads.map((lead, i) => (
                  <CompactCard
                    key={lead.domain}
                    lead={lead}
                    isDragging={dragCardSource?.domain === lead.domain}
                    isDropBefore={dropCardTarget?.column === col.id && dropCardTarget?.index === i}
                    onClick={() => setSelectedDomain(lead.domain)}
                    onEmailClick={(e) => { e.stopPropagation(); setEmailModal(lead.domain); }}
                    onDragStart={(e) => handleCardDragStart(e, lead.domain, col.id)}
                    onDragOver={(e) => handleCardDragOverCard(e, col.id, i)}
                    onDragEnd={resetDrag}
                    onDrop={(e) => handleCardDrop(e, col.id, i)}
                  />
                ))}
                {leads.length === 0 && (
                  <div className="text-[10px] text-muted-foreground text-center py-6 italic">
                    Deposer ici
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Minor statuses */}
      {minorLeads > 0 && (
        <div className="border rounded-lg bg-white">
          <button
            onClick={() => setShowMinor(!showMinor)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30"
          >
            {showMinor ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Autres statuts ({minorLeads})
          </button>
          {showMinor && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {MINOR_STATUSES.map(status => {
                const leads = pipeline[status] || [];
                if (leads.length === 0) return null;
                return (
                  <div key={status} className="border rounded p-1.5 min-w-[160px]">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[10px] font-medium text-muted-foreground">{status.replace(/_/g, " ")}</span>
                      <Badge variant="secondary" className="text-[9px] h-3.5 px-1">{leads.length}</Badge>
                    </div>
                    <div className="space-y-0.5">
                      {leads.slice(0, 5).map(l => (
                        <button
                          key={l.domain}
                          onClick={() => setSelectedDomain(l.domain)}
                          className="block text-[10px] text-muted-foreground truncate hover:text-foreground w-full text-left"
                        >
                          {l.nom_entreprise || l.domain}
                        </button>
                      ))}
                      {leads.length > 5 && (
                        <span className="text-[9px] text-muted-foreground/50">+{leads.length - 5} autres</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lead detail sheet */}
      <LeadSheet
        domain={selectedDomain}
        onClose={() => setSelectedDomain(null)}
        onUpdated={() => { setSelectedDomain(null); fetchPipeline(); }}
      />

      {/* Email modal */}
      {emailModal && (
        <EmailComposeModal
          domain={emailModal}
          lead={Object.values(pipeline).flat().find(l => l.domain === emailModal) || null}
          onClose={() => setEmailModal(null)}
          onSent={() => { setEmailModal(null); fetchPipeline(); }}
        />
      )}
    </div>
  );
}

function CompactCard({
  lead,
  isDragging,
  isDropBefore,
  onClick,
  onEmailClick,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  lead: PipelineLead;
  isDragging: boolean;
  isDropBefore: boolean;
  onClick: () => void;
  onEmailClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const bestEmail = lead.dirigeant_email || lead.email;
  const name = lead.nom_entreprise || lead.domain;

  return (
    <>
      {isDropBefore && <div className="h-0.5 bg-primary rounded-full mx-1" />}
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        onClick={onClick}
        className={`
          bg-white border rounded px-2 py-1.5 cursor-pointer
          hover:shadow-sm hover:border-primary/30 transition-all
          active:cursor-grabbing
          ${isDragging ? "opacity-40 scale-95" : ""}
        `}
      >
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-medium truncate flex-1">{name}</span>
          {lead.qualification != null && lead.qualification > 0 && (
            <span className={`text-[9px] font-bold shrink-0 ${
              lead.qualification >= 7 ? "text-green-600" :
              lead.qualification >= 4 ? "text-orange-600" : "text-red-600"
            }`}>
              {lead.qualification}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {lead.phone && <Phone className="h-2.5 w-2.5 text-blue-400 shrink-0" />}
          {bestEmail && (
            <button onClick={onEmailClick} className="hover:text-green-600 transition-colors" title="Envoyer email">
              <Mail className="h-2.5 w-2.5 text-green-400" />
            </button>
          )}
          {lead.ville && (
            <span className="text-[9px] text-muted-foreground/60 truncate ml-0.5">{lead.ville}</span>
          )}
          <div className="flex items-center gap-0.5 ml-auto">
            {lead.email_count > 0 && (
              <span className="text-[9px] text-blue-400 flex items-center gap-px">
                <MessageSquare className="h-2 w-2" />{lead.email_count}
              </span>
            )}
            {lead.pending_followups > 0 && (
              <span className="text-[9px] text-amber-500 flex items-center gap-px">
                <Clock className="h-2 w-2" />{lead.pending_followups}
              </span>
            )}
            {lead.contacted_date && (
              <span className="text-[9px] text-muted-foreground/40">
                {formatTimeAgo(lead.contacted_date)}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function EmailComposeModal({
  domain,
  lead,
  onClose,
  onSent,
}: {
  domain: string;
  lead: PipelineLead | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const bestEmail = lead?.dirigeant_email || lead?.email || "";
  const [to, setTo] = useState(bestEmail);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!to || !subject || !body) { toast.error("Remplissez tous les champs"); return; }
    setSending(true);
    const toastId = toast.loading("Envoi de l'email...");
    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(domain)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      if (res.ok) { toast.success("Email envoye !", { id: toastId }); onSent(); }
      else { const r = await res.json(); toast.error(r.error || "Erreur", { id: toastId }); }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Send className="h-4 w-4 text-green-600" />
            {lead?.nom_entreprise || domain}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <Label className="text-xs">De</Label>
            <Input value="robert.brunon@veridian.site" disabled className="h-8 text-sm bg-muted/30" />
          </div>
          <div>
            <Label className="text-xs">A</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@exemple.fr" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Objet</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet..." className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Bonjour..." className="min-h-[180px] text-sm" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/20 rounded-b-xl">
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={handleSend} disabled={sending} className="gap-1.5 bg-green-600 hover:bg-green-700">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Envoyer
          </Button>
        </div>
      </div>
    </div>
  );
}
