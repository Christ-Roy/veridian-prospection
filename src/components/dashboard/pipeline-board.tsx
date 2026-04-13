"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { LeadSheet } from "./lead-sheet";
import { formatCA, PIPELINE_STAGES, INTEREST_SCALE } from "@/lib/types";
import { StageTransitionModal, type StageData } from "./lead-sheet/stage-transition";
import { toast } from "sonner";
import {
  Phone,
  Mail,
  Send,
  Loader2,
  X,
  MessageSquare,
  Clock,
  RefreshCw,
  TrendingUp,
  Calendar,
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
  pipeline_stage: string | null;
  interest_pct: number | null;
  deadline: string | null;
  site_price: number | null;
  acompte_pct: number | null;
  acompte_amount: number | null;
  monthly_recurring: number | null;
  annual_deal: boolean | null;
  estimated_value: number | null;
  real_value: number | null;
  upsell_estimated: number | null;
  last_interaction_at: string | null;
}

/** Days since last interaction */
function daysSince(lead: PipelineLead): number {
  const d = lead.last_interaction_at || lead.last_visited || lead.contacted_date;
  if (!d) return 99;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

/** Sort leads: by deadline first (nearest), then by interest (highest), then by days */
function sortLeads(leads: PipelineLead[]): PipelineLead[] {
  return [...leads].sort((a, b) => {
    // Leads with deadline first, sorted by nearest
    if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    // Then by interest (highest first)
    if (a.interest_pct != null && b.interest_pct != null) return b.interest_pct - a.interest_pct;
    if (a.interest_pct != null) return -1;
    if (b.interest_pct != null) return 1;
    // Then by days since interaction (most recent first)
    return daysSince(a) - daysSince(b);
  });
}

/** Interest description from scale */
function interestLabel(pct: number): string {
  for (let i = INTEREST_SCALE.length - 1; i >= 0; i--) {
    if (pct >= INTEREST_SCALE[i].pct) return INTEREST_SCALE[i].label;
  }
  return "";
}

export function PipelineBoard() {
  const [pipeline, setPipeline] = useState<Record<string, PipelineLead[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [emailModal, setEmailModal] = useState<string | null>(null);

  // Stage transition modal from pipeline
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionLead, setTransitionLead] = useState<PipelineLead | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<string>("");

  // Drag state
  const [dragType, setDragType] = useState<"card" | null>(null);
  const [dragCardSource, setDragCardSource] = useState<{ domain: string; column: string } | null>(null);
  const [dropCardTarget, setDropCardTarget] = useState<{ column: string; index: number } | null>(null);

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pipeline");
      const data = await res.json();
      setPipeline(data.pipeline);
    } catch {
      toast.error("Erreur chargement pipeline");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

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

    // If moving to a different stage, open transition modal
    if (sourceColumn !== targetColumn) {
      const lead = Object.values(pipeline).flat().find(l => l.domain === domain);
      if (lead) {
        setTransitionLead(lead);
        setTransitionTarget(targetColumn);
        setTransitionOpen(true);
      }
      resetDrag();
      return;
    }

    // Same column reorder — optimistic
    const prevPipeline = { ...pipeline };
    for (const k of Object.keys(prevPipeline)) prevPipeline[k] = [...prevPipeline[k]];

    const next = { ...pipeline };
    const sourceLeads = [...(next[sourceColumn] || [])];
    const cardIdx = sourceLeads.findIndex(l => l.domain === domain);
    if (cardIdx === -1) { resetDrag(); return; }
    const [card] = sourceLeads.splice(cardIdx, 1);
    next[sourceColumn] = sourceLeads;
    let insertIdx = targetIndex;
    if (cardIdx < targetIndex) insertIdx--;
    sourceLeads.splice(Math.max(0, insertIdx), 0, card);
    next[sourceColumn] = sourceLeads;

    setPipeline(next);
    resetDrag();

    try {
      const res = await fetch("/api/pipeline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchReorder: true, columns: [{ status: sourceColumn, sirens: next[sourceColumn].map(l => l.siren).filter(Boolean) }] }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPipeline(prevPipeline);
      toast.error("Erreur sauvegarde");
    }
  }

  // Stage transition from drag or from card button
  async function handleStageTransitionConfirm(data: StageData) {
    if (!transitionLead) return;
    const lead = transitionLead;
    const sourceStage = lead.pipeline_stage || lead.outreach_status || "fiche_ouverte";

    // Optimistic: move card client-side
    const next = { ...pipeline };
    for (const k of Object.keys(next)) next[k] = [...next[k]];

    // Remove from source
    const sourceLeads = next[sourceStage] || [];
    next[sourceStage] = sourceLeads.filter(l => l.domain !== lead.domain);
    if (next[sourceStage].length === 0) delete next[sourceStage];

    // Add to target with updated data
    const updatedLead = {
      ...lead,
      pipeline_stage: data.pipeline_stage,
      outreach_status: data.pipeline_stage,
      interest_pct: data.interest_pct ?? lead.interest_pct,
      deadline: data.deadline ?? lead.deadline,
      estimated_value: data.estimated_value ?? lead.estimated_value,
      site_price: data.site_price ?? lead.site_price,
      acompte_amount: data.acompte_amount ?? lead.acompte_amount,
      monthly_recurring: data.monthly_recurring ?? lead.monthly_recurring,
      outreach_notes: data.notes ?? lead.outreach_notes,
    };
    if (!next[data.pipeline_stage]) next[data.pipeline_stage] = [];
    next[data.pipeline_stage].push(updatedLead);

    setPipeline(next);
    setTransitionOpen(false);
    setTransitionLead(null);

    // Background save
    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(lead.domain)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: data.pipeline_stage, ...data }),
      });
      if (!res.ok) throw new Error();
      toast.success("Pipeline mis a jour");
    } catch {
      // Rollback would be complex — just refetch
      fetchPipeline();
      toast.error("Erreur — rechargement");
    }
  }

  function resetDrag() {
    setDragType(null);
    setDragCardSource(null);
    setDropCardTarget(null);
  }

  // Pipeline value
  const allLeads = Object.values(pipeline).flat();
  const pipelineValue = allLeads.reduce((sum, l) => sum + (l.estimated_value || l.real_value || 0), 0);
  const realValue = allLeads.filter(l => ["acompte", "client"].includes(l.pipeline_stage || "")).reduce((sum, l) => sum + (l.real_value || l.acompte_amount || 0), 0);
  const monthlyRecurring = allLeads.filter(l => l.monthly_recurring).reduce((sum, l) => sum + (l.monthly_recurring || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Chargement du pipeline...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pipeline</h2>
          <Badge variant="outline" className="text-xs">{allLeads.length} leads</Badge>
          {pipelineValue > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span className="font-mono font-semibold text-foreground">{formatCA(pipelineValue)}</span>
              {realValue > 0 && <> | <span className="font-mono font-semibold text-green-600">{formatCA(realValue)}</span> reel</>}
              {monthlyRecurring > 0 && <> | <span className="font-mono text-blue-600">{formatCA(monthlyRecurring)}/mois</span></>}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={fetchPipeline} className="gap-1.5 h-8">
          <RefreshCw className="h-3.5 w-3.5" /> Rafraichir
        </Button>
      </div>

      {/* Kanban — fills remaining height, columns scroll internally */}
      <div className="flex gap-2 overflow-x-auto flex-1 min-h-0 pb-2">
        {PIPELINE_STAGES.map(stage => {
          const rawLeads = pipeline[stage.id] || [];
          const leads = sortLeads(rawLeads);
          const isCardDropColumn = dragType === "card" && dropCardTarget?.column === stage.id;
          const colValue = leads.reduce((s, l) => s + (l.estimated_value || l.real_value || 0), 0);

          return (
            <div
              key={stage.id}
              className={`flex flex-col min-w-[220px] flex-1 min-h-0 rounded-lg border transition-all ${
                isCardDropColumn ? "border-primary/30 bg-primary/5" : "bg-muted/30"
              }`}
              onDragOver={(e) => handleCardDragOverColumn(e, stage.id)}
              onDrop={(e) => handleCardDrop(e, stage.id, leads.length)}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-2.5 py-2 border-b bg-white rounded-t-lg shrink-0">
                <div className={`h-2.5 w-2.5 rounded-full ${stage.color}`} />
                <span className="text-xs font-semibold">{stage.label}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-auto">{leads.length}</Badge>
                {colValue > 0 && <span className="text-[9px] font-mono text-muted-foreground">{formatCA(colValue)}</span>}
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                {leads.map((lead, i) => (
                  <PipelineCard
                    key={lead.domain}
                    lead={lead}
                    stage={stage}
                    isDragging={dragCardSource?.domain === lead.domain}
                    isDropBefore={dropCardTarget?.column === stage.id && dropCardTarget?.index === i}
                    onClick={() => setSelectedDomain(lead.domain)}
                    onDragStart={(e) => handleCardDragStart(e, lead.domain, stage.id)}
                    onDragOver={(e) => handleCardDragOverCard(e, stage.id, i)}
                    onDragEnd={resetDrag}
                    onDrop={(e) => handleCardDrop(e, stage.id, i)}
                  />
                ))}
                {leads.length === 0 && (
                  <div className="text-[10px] text-muted-foreground text-center py-8 italic">Deposer ici</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lead sheet */}
      <LeadSheet
        domain={selectedDomain}
        onClose={() => setSelectedDomain(null)}
        onUpdated={() => {}}
      />

      {/* Stage transition modal */}
      <StageTransitionModal
        open={transitionOpen}
        targetStage={transitionTarget}
        domain={transitionLead?.domain || ""}
        dirigeant={transitionLead?.dirigeant || null}
        onConfirm={handleStageTransitionConfirm}
        onCancel={() => { setTransitionOpen(false); setTransitionLead(null); }}
      />

      {/* Email modal */}
      {emailModal && (
        <EmailComposeModal
          domain={emailModal}
          lead={allLeads.find(l => l.domain === emailModal) || null}
          onClose={() => setEmailModal(null)}
          onSent={() => { setEmailModal(null); fetchPipeline(); }}
        />
      )}
    </div>
  );
}

// ============================================================================
// PIPELINE CARD — richer, contextual per stage
// ============================================================================

function PipelineCard({
  lead,
  stage,
  isDragging,
  isDropBefore,
  onClick,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  lead: PipelineLead;
  stage: (typeof PIPELINE_STAGES)[number];
  isDragging: boolean;
  isDropBefore: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const name = lead.nom_entreprise || lead.domain;
  const days = daysSince(lead);
  const archiveDays = stage.autoArchiveDays;
  const archiveRatio = archiveDays ? Math.min(1, days / archiveDays) : 0;
  const isUrgent = archiveDays ? days >= archiveDays : false;
  const pct = lead.interest_pct ?? 0;

  // Interest animation intensity
  const interestStyle: React.CSSProperties = {};
  if (stage.id === "site_demo" && lead.interest_pct != null) {
    const intensity = lead.interest_pct / 100;
    interestStyle.boxShadow = intensity > 0.6
      ? `inset 0 0 ${20 + intensity * 30}px rgba(234, 179, 8, ${intensity * 0.4})`
      : undefined;
    interestStyle.background = `linear-gradient(135deg, white ${100 - lead.interest_pct}%, rgba(234, 179, 8, ${0.1 + intensity * 0.25}) 100%)`;
  }

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
        style={interestStyle}
        className={`
          relative overflow-hidden border rounded-lg px-3 py-2.5 cursor-pointer
          hover:shadow-md hover:border-primary/30 transition-all
          active:cursor-grabbing bg-white
          ${isDragging ? "opacity-40 scale-95" : ""}
          ${isUrgent ? "border-red-300" : ""}
          ${stage.id === "site_demo" && pct >= 80 ? "animate-pulse" : ""}
        `}
      >
        {/* Urgency bar */}
        {archiveDays && archiveRatio > 0 && (
          <div
            className={`absolute bottom-0 left-0 h-1 transition-all rounded-bl ${isUrgent ? "bg-red-400" : "bg-orange-200"}`}
            style={{ width: `${archiveRatio * 100}%` }}
          />
        )}

        {/* Row 1: Name + Value */}
        <div className="flex items-start gap-1 min-w-0">
          <span className="text-sm font-semibold truncate flex-1 leading-tight">{name}</span>
          {(lead.estimated_value || lead.real_value || lead.acompte_amount) && (
            <span className="text-[10px] font-mono text-emerald-600 shrink-0 font-bold">
              {formatCA(lead.real_value || lead.acompte_amount || lead.estimated_value || 0)}
            </span>
          )}
        </div>

        {/* Row 2: Dirigeant */}
        {lead.dirigeant && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">{lead.dirigeant}</div>
        )}

        {/* Row 3: Stage-specific data */}
        <div className="mt-1.5 space-y-1">
          {/* Deadline / RDV */}
          {lead.deadline && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-purple-500 shrink-0" />
              <span className={`text-[11px] font-medium ${
                new Date(lead.deadline) < new Date() ? "text-red-600" : "text-purple-600"
              }`}>
                {new Date(lead.deadline).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                {" "}
                {new Date(lead.deadline).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}

          {/* Interest gauge for site_demo */}
          {stage.id === "site_demo" && lead.interest_pct != null && (
            <div>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-lime-500" : pct >= 40 ? "bg-yellow-400" : pct >= 20 ? "bg-orange-400" : "bg-red-400"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold font-mono w-8 text-right">{pct}%</span>
              </div>
              <p className="text-[9px] text-muted-foreground mt-0.5">{interestLabel(pct)}</p>
            </div>
          )}

          {/* Acompte / pricing info */}
          {stage.id === "acompte" && lead.site_price != null && (
            <div className="flex gap-2 text-[10px]">
              <span className="text-muted-foreground">Devis: <span className="font-mono font-semibold text-foreground">{formatCA(lead.site_price)}</span></span>
              {lead.acompte_amount != null && (
                <span className="text-green-600 font-semibold">Acompte: {formatCA(lead.acompte_amount)}</span>
              )}
            </div>
          )}

          {/* Monthly recurring */}
          {lead.monthly_recurring != null && lead.monthly_recurring > 0 && (
            <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-mono">{lead.monthly_recurring}€/mois</span>
          )}
        </div>

        {/* Bottom row: contact + meta */}
        <div className="flex items-center gap-1 mt-1.5 pt-1 border-t border-slate-100">
          {lead.phone && <Phone className="h-2.5 w-2.5 text-green-500 shrink-0" />}
          {(lead.email || lead.dirigeant_email) && <Mail className="h-2.5 w-2.5 text-blue-400 shrink-0" />}
          {lead.ville && <span className="text-[9px] text-muted-foreground/60 truncate">{lead.ville}</span>}
          <div className="flex items-center gap-1 ml-auto">
            {lead.outreach_notes && <MessageSquare className="h-2.5 w-2.5 text-rose-400" />}
            {lead.pending_followups > 0 && (
              <span className="text-[9px] text-amber-500 flex items-center gap-px"><Clock className="h-2 w-2" />{lead.pending_followups}</span>
            )}
            {archiveDays && (
              <span className={`text-[9px] ${isUrgent ? "text-red-600 font-bold" : "text-muted-foreground/40"}`}>{days}j</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// EMAIL COMPOSE MODAL
// ============================================================================

function EmailComposeModal({
  domain, lead, onClose, onSent,
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
    const toastId = toast.loading("Envoi...");
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
            <Send className="h-4 w-4 text-green-600" /> {lead?.nom_entreprise || domain}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div><Label className="text-xs">De</Label><Input value="robert.brunon@veridian.site" disabled className="h-8 text-sm bg-muted/30" /></div>
          <div><Label className="text-xs">A</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@exemple.fr" className="h-8 text-sm" /></div>
          <div><Label className="text-xs">Objet</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet..." className="h-8 text-sm" /></div>
          <div><Label className="text-xs">Message</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Bonjour..." className="min-h-[180px] text-sm" /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/20 rounded-b-xl">
          <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" onClick={handleSend} disabled={sending} className="gap-1.5 bg-green-600 hover:bg-green-700">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer
          </Button>
        </div>
      </div>
    </div>
  );
}
