"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { webHref } from "@/lib/utils";

/** Safely parse a JSON array string. Returns [] on invalid JSON (e.g. obfuscated data). */
function safeParseArray(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

/** Map raw BODACC status codes to French human-readable labels. */
function formatBodaccStatus(status: string): string {
  const map: Record<string, string> = {
    sauvegarde: "Sauvegarde",
    redressement: "Redressement judiciaire",
    liquidation: "Liquidation judiciaire",
    procedure: "Procedure en cours",
  };
  return map[status.toLowerCase()] ?? status;
}
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeadDetail, ClaudeActivity, Followup } from "@/lib/types";
import {
  CLAUDE_ACTIVITY_COLORS,
  CLAUDE_ACTIVITY_LABELS,
  formatCA,
  formatEffectifs,
  formatTimeAgo,
} from "@/lib/types";
import type { ClaudeActivityType } from "@/lib/types";
import { formatNaf } from "@/lib/naf";
import { toast } from "sonner";
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  Wrench,
  Globe,
  Linkedin,
  Facebook,
  Instagram,
  Loader2,
  Star,
  ChevronDown,
  ChevronRight,
  Send,
  Edit3,
  Save,
  X,
  Plus,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Award,
  ShieldAlert,
} from "lucide-react";

// --- Shared helpers ---

function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  if (!value || value === "-" || value === " ") return null;
  return (
    <div className="flex items-start gap-2 py-1">
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="text-sm font-medium break-all">{value}</div>
      </div>
    </div>
  );
}

function SocialLink({ url, icon }: { url: string | null; icon: React.ReactNode }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
      {icon}
    </a>
  );
}

// --- Pages Jaunes section ---

export function PagesJaunesSection({ lead }: { lead: LeadDetail }) {
  if (!lead.is_pj_lead) return null;
  return (
    <div className="grid gap-0">
      {lead.activites_pj && (
        <div className="py-1">
          <span className="text-xs text-muted-foreground">Activites</span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {lead.activites_pj.split(",").map((a, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] h-5 px-1.5">{a.replace(/-$/, "").trim()}</Badge>
            ))}
          </div>
        </div>
      )}
      {(lead.rating_pj || (lead.nb_avis_pj != null && lead.nb_avis_pj > 0)) && (
        <div className="flex items-center gap-2 py-1">
          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
          <span className="text-sm font-medium">{lead.rating_pj || "-"}/5</span>
          <span className="text-xs text-muted-foreground">({lead.nb_avis_pj} avis)</span>
        </div>
      )}
      {lead.pj_description && (
        <InfoRow label="Description PJ" value={
          <span className="text-xs text-muted-foreground">{lead.pj_description.length > 200 ? lead.pj_description.slice(0, 200) + "..." : lead.pj_description}</span>
        } />
      )}
      {lead.is_solocal === 1 && (
        <InfoRow label="Plateforme" value={
          <div className="flex flex-col gap-1">
            <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-[10px]">
              Site Solocal (Duda){lead.solocal_tier && lead.solocal_tier !== "SOLOCAL_UNKNOWN" ? ` — ${
                lead.solocal_tier === "ESSENTIEL" ? "Essentiel (~80/mois)" :
                lead.solocal_tier === "PREMIUM" ? "Premium (~200/mois)" :
                lead.solocal_tier === "PERFORMANCE" ? "Performance (~220/mois)" :
                lead.solocal_tier === "PRIVILEGE" ? "Privilege (~355/mois)" :
                lead.solocal_tier
              }` : ""}
            </Badge>
            {lead.solocal_tier && lead.solocal_tier !== "SOLOCAL_UNKNOWN" && lead.solocal_tier !== "EXTERNE" && (
              <span className="text-[10px] text-orange-600">
                Depense site estimee : {
                  lead.solocal_tier === "ESSENTIEL" ? "~1 000/an" :
                  lead.solocal_tier === "PREMIUM" ? "~2 400/an" :
                  lead.solocal_tier === "PERFORMANCE" ? "~2 700/an" :
                  lead.solocal_tier === "PRIVILEGE" ? "~4 500/an" : ""
                }
              </span>
            )}
          </div>
        } />
      )}
      {lead.is_solocal === 0 && lead.pj_website_url && (
        <InfoRow label="Plateforme" value={
          <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">
            Site externe{lead.solocal_tier === "EXTERNE" ? " (SITE_EXTERNE)" : ""}
          </Badge>
        } />
      )}
      {lead.honeypot_flag && (
        <InfoRow label="Honeypot" value={
          <div className="flex flex-col gap-1">
            <Badge className={`text-[10px] ${
              lead.honeypot_flag === "PROBABLE" ? "bg-red-100 text-red-800 border-red-300" :
              lead.honeypot_flag === "SUSPECT" ? "bg-orange-100 text-orange-700 border-orange-200" :
              "bg-yellow-50 text-yellow-700 border-yellow-200"
            }`}>
              {lead.honeypot_flag} (score: {lead.honeypot_score})
            </Badge>
            {lead.honeypot_reasons && (
              <div className="flex flex-wrap gap-0.5 mt-0.5">
                {(safeParseArray(lead.honeypot_reasons)).map((r: string, i: number) => (
                  <span key={i} className="text-[10px] text-red-600">{r}</span>
                ))}
              </div>
            )}
          </div>
        } />
      )}
    </div>
  );
}

// --- Entreprise section ---

export function EntrepriseSection({ lead }: { lead: LeadDetail }) {
  return (
    <div className="grid gap-0">
      <InfoRow label="Forme juridique" value={lead.forme_juridique} />
      <InfoRow label="SIRET" value={lead.siret} />
      <InfoRow label="SIREN" value={lead.siren} />
      <InfoRow label="TVA" value={lead.tva_intracom} />
      <InfoRow label="Secteur" value={formatNaf(lead.code_naf)} />
      <InfoRow label="Categorie" value={lead.categorie} />
      <InfoRow label="Effectifs" value={formatEffectifs(lead.effectifs)} />
      <InfoRow label="CA" value={formatCA(lead.ca)} />
      <InfoRow label="Dirigeant" value={lead.dirigeant} icon={<Building2 className="h-3.5 w-3.5" />} />
      <InfoRow label="Qualite" value={lead.qualite_dirigeant} />
      {/* Location */}
      <InfoRow label="Adresse" value={lead.api_adresse || lead.address} icon={<MapPin className="h-3.5 w-3.5" />} />
      <InfoRow label="Ville" value={[lead.ville, lead.code_postal].filter(Boolean).join(" ")} />
      <InfoRow label="Departement" value={lead.departement} />
    </div>
  );
}

// --- Contact section ---

export function ContactSection({ lead }: { lead: LeadDetail }) {
  return (
    <div className="grid gap-0">
      <InfoRow label="Dirigeant" value={lead.dirigeant} icon={<Building2 className="h-3.5 w-3.5" />} />
      <InfoRow label="Qualite" value={lead.qualite_dirigeant} />

      {/* Dirigeant emails */}
      {lead.dirigeant_emails_all && lead.dirigeant_emails_all !== "" && lead.dirigeant_emails_all !== "[]" ? (
        <InfoRow
          label="Emails dirigeant"
          value={
            <div className="flex flex-wrap gap-1">
              {(safeParseArray(lead.dirigeant_emails_all)).map((email: string) => (
                <a key={email} href={`mailto:${email}`} className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded hover:underline font-medium">{email}</a>
              ))}
            </div>
          }
          icon={<Mail className="h-3.5 w-3.5" />}
        />
      ) : lead.dirigeant_email ? (
        <InfoRow
          label="Email dirigeant"
          value={<a href={`mailto:${lead.dirigeant_email}`} className="text-blue-600 hover:underline">{lead.dirigeant_email}</a>}
          icon={<Mail className="h-3.5 w-3.5" />}
        />
      ) : null}

      {/* Company emails */}
      {lead.emails && lead.emails !== "" && lead.emails !== "[]" ? (
        <InfoRow
          label="Emails entreprise"
          value={
            <div className="flex flex-wrap gap-1">
              {(safeParseArray(lead.emails)).map((email: string) => (
                <a key={email} href={`mailto:${email}`} className="text-xs bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded hover:underline">{email}</a>
              ))}
            </div>
          }
          icon={<Mail className="h-3.5 w-3.5" />}
        />
      ) : lead.email ? (
        <InfoRow
          label="Email"
          value={<a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">{lead.email}</a>}
          icon={<Mail className="h-3.5 w-3.5" />}
        />
      ) : null}

      {/* SMTP aliases */}
      {lead.aliases_found && lead.aliases_found !== "" && lead.aliases_found !== "[]" && (
        <InfoRow
          label="Aliases SMTP"
          value={
            <div className="flex flex-wrap gap-1">
              {(safeParseArray(lead.aliases_found)).map((alias: string) => (
                <a key={alias} href={`mailto:${alias}`} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded hover:underline">{alias}</a>
              ))}
            </div>
          }
          icon={<Mail className="h-3.5 w-3.5" />}
        />
      )}

      {lead.mail_provider && lead.mail_provider !== "" && (
        <InfoRow
          label="Provider mail"
          value={<span className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{lead.mail_provider}</span>}
        />
      )}
      {lead.is_catch_all === 1 && (
        <InfoRow
          label="Catch-all"
          value={<span className="text-xs text-orange-600 font-medium">Serveur accepte tout (non verifiable)</span>}
        />
      )}

      {/* Phones */}
      {lead.phones && lead.phones !== "" && lead.phones !== "[]" ? (
        <InfoRow
          label="Telephones"
          value={
            <div className="flex flex-wrap gap-1">
              {(safeParseArray(lead.phones)).map((tel: string, i: number) => (
                <a key={tel} href={`tel:${tel}`} className={`text-xs px-1.5 py-0.5 rounded hover:underline ${i === 0 ? "bg-green-50 text-green-700 font-medium" : "bg-slate-50 text-slate-700"}`}>{tel}</a>
              ))}
            </div>
          }
          icon={<Phone className="h-3.5 w-3.5" />}
        />
      ) : lead.phone ? (
        <InfoRow
          label="Telephone"
          value={<a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">{lead.phone}</a>}
          icon={<Phone className="h-3.5 w-3.5" />}
        />
      ) : null}

      {lead.phone_type && (
        <InfoRow label="Type tel" value={`${lead.phone_type}${lead.phone_carrier ? ` (${lead.phone_carrier})` : ""}`} />
      )}
      {lead.phone_test === 1 && <InfoRow label="Attention" value={<span className="text-red-600 font-bold">Numero test/fake</span>} />}
      {lead.phone_shared === 1 && <InfoRow label="Attention" value={<span className="text-orange-600">Numero partage (agence?)</span>} />}

      {/* Social */}
      {(lead.social_linkedin || lead.social_facebook || lead.social_instagram) && (
        <div className="flex gap-3 py-2">
          <SocialLink url={lead.social_linkedin} icon={<Linkedin className="h-5 w-5" />} />
          <SocialLink url={lead.social_facebook} icon={<Facebook className="h-5 w-5" />} />
          <SocialLink url={lead.social_instagram} icon={<Instagram className="h-5 w-5" />} />
        </div>
      )}
    </div>
  );
}

// --- Technique section ---

export function TechniqueSection({ lead }: { lead: LeadDetail }) {
  return (
    <div className="grid gap-0">
      <InfoRow label="CMS" value={lead.cms} icon={<Wrench className="h-3.5 w-3.5" />} />
      <InfoRow label="Plateforme" value={lead.platform_name} />
      <InfoRow label="Copyright" value={lead.copyright_year?.toString()} />
      <InfoRow label="Responsive" value={lead.has_responsive ? "Oui" : "Non"} />
      <InfoRow label="HTTPS" value={lead.has_https ? "Oui" : "Non"} icon={<Globe className="h-3.5 w-3.5" />} />
      <InfoRow label="Generator" value={lead.generator} />
      <InfoRow label="PHP" value={lead.php_version} />
      <InfoRow label="jQuery" value={lead.jquery_version} />
    </div>
  );
}

// --- Claude Activity section ---

export function ClaudeNotesSection({ activities, domain, onUpdate }: { activities: ClaudeActivity[]; domain: string; onUpdate: () => void }) {
  if (activities.length === 0) return <p className="text-xs text-muted-foreground">Aucune note Claude</p>;
  return (
    <div className="space-y-2">
      {activities.map((activity) => (
        <ClaudeActivityCard key={activity.id} activity={activity} domain={domain} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function ClaudeActivityCard({ activity, domain, onUpdate }: { activity: ClaudeActivity; domain: string; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(activity.content);
  const [sending, setSending] = useState(false);

  const isLong = activity.content.length > 200;
  const isDraft = activity.activity_type === "email_draft";
  const colorClass = CLAUDE_ACTIVITY_COLORS[activity.activity_type as ClaudeActivityType] ?? "bg-gray-100 text-gray-700 border-gray-200";
  const label = CLAUDE_ACTIVITY_LABELS[activity.activity_type as ClaudeActivityType] ?? activity.activity_type;

  async function handleSave() {
    const toastId = toast.loading("Sauvegarde du draft...");
    try {
      const res = await fetch(`/api/claude/${encodeURIComponent(domain)}/${activity.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        toast.success("Draft sauvegarde", { id: toastId });
        setEditing(false);
        onUpdate();
      } else {
        toast.error("Erreur", { id: toastId });
      }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    }
  }

  async function handleSend() {
    setSending(true);
    const toastId = toast.loading("Envoi de l'email...");
    try {
      const lines = editContent.split("\n");
      let to = "", subject = "", bodyStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("To:")) to = lines[i].replace("To:", "").trim();
        else if (lines[i].startsWith("Subject:")) subject = lines[i].replace("Subject:", "").trim();
        else if (lines[i].trim() === "") { bodyStart = i + 1; break; }
      }
      const body = lines.slice(bodyStart).join("\n").trim();
      if (!to || !subject || !body) { toast.error("Draft invalide", { id: toastId }); setSending(false); return; }

      const res = await fetch(`/api/outreach/${encodeURIComponent(domain)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      if (res.ok) { toast.success("Email envoye !", { id: toastId }); onUpdate(); }
      else { const r = await res.json(); toast.error(r.error || "Erreur", { id: toastId }); }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    } finally { setSending(false); }
  }

  return (
    <div className="border rounded-md p-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge className={`text-[10px] h-5 px-1.5 ${colorClass}`}>{label}</Badge>
        {activity.title && <span className="text-sm font-medium truncate">{activity.title}</span>}
        <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
          {formatTimeAgo(activity.created_at) ?? activity.created_at}
        </span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-[200px] text-xs font-mono" />
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={handleSave} className="h-7 gap-1"><Save className="h-3 w-3" /> Sauver</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditContent(activity.content); }} className="h-7 gap-1"><X className="h-3 w-3" /> Annuler</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
            {isLong && !expanded ? activity.content.slice(0, 200) + "..." : activity.content}
          </div>
          <div className="flex items-center gap-1.5">
            {isLong && (
              <button className="text-[10px] text-cyan-600 hover:underline flex items-center gap-0.5" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {expanded ? "Reduire" : "Voir plus"}
              </button>
            )}
            {isDraft && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="h-6 gap-1 text-[10px]"><Edit3 className="h-3 w-3" /> Modifier</Button>
                <Button size="sm" onClick={handleSend} disabled={sending} className="h-6 gap-1 text-[10px] bg-green-600 hover:bg-green-700">
                  {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Envoyer
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --- Followup section ---

export function FollowupSection({
  followups,
  onAdd,
  onUpdate,
}: {
  followups: Followup[];
  onAdd: (scheduled_at: string, note: string) => void;
  onUpdate: (id: number, status: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [note, setNote] = useState("");

  function handleAdd() {
    if (!scheduledAt) { toast.error("Date/heure requise"); return; }
    onAdd(scheduledAt, note);
    setAdding(false);
    setScheduledAt("");
    setNote("");
  }

  const pending = followups.filter(f => f.status === "pending");
  const done = followups.filter(f => f.status === "done");
  const cancelled = followups.filter(f => f.status === "cancelled");

  return (
    <div className="space-y-2">
      {pending.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-amber-600">En attente</span>
          {pending.map(f => <FollowupCard key={f.id} followup={f} onUpdate={onUpdate} />)}
        </div>
      )}
      {done.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-green-600">Termines</span>
          {done.map(f => <FollowupCard key={f.id} followup={f} onUpdate={onUpdate} />)}
        </div>
      )}
      {cancelled.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-gray-500">Annules</span>
          {cancelled.map(f => <FollowupCard key={f.id} followup={f} onUpdate={onUpdate} />)}
        </div>
      )}
      {adding ? (
        <div className="border rounded-md p-2.5 space-y-2 bg-amber-50">
          <div>
            <Label htmlFor="scheduled_at" className="text-xs">Date/heure</Label>
            <Input id="scheduled_at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="text-xs h-8" />
          </div>
          <div>
            <Label htmlFor="note" className="text-xs">Note</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} className="text-xs h-16" placeholder="Rappel: relancer par phone..." />
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={handleAdd} className="h-7 gap-1"><Plus className="h-3 w-3" /> Ajouter</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} className="h-7 gap-1"><X className="h-3 w-3" /> Annuler</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="w-full gap-1">
          <Plus className="h-3 w-3" /> Ajouter un follow-up
        </Button>
      )}
    </div>
  );
}

// --- Finances Section (INPI v3.6 enriched) ---

const CA_TREND_LABELS: Record<string, { label: string; color: string }> = {
  growth_strong: { label: "Croissance forte", color: "bg-green-100 text-green-800 border-green-200" },
  growth_continuous: { label: "Croissance continue", color: "bg-green-100 text-green-700 border-green-200" },
  growth: { label: "Croissance", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  stable: { label: "Stable", color: "bg-gray-100 text-gray-700 border-gray-200" },
  decline: { label: "Declin", color: "bg-orange-100 text-orange-700 border-orange-200" },
  crash: { label: "Effondrement", color: "bg-red-100 text-red-800 border-red-200" },
};

const PROFITABILITY_LABELS: Record<string, { label: string; color: string }> = {
  top: { label: "Tres rentable", color: "bg-green-100 text-green-800 border-green-200" },
  good: { label: "Rentable", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  thin: { label: "Marge fine", color: "bg-amber-100 text-amber-700 border-amber-200" },
  loss: { label: "Deficitaire", color: "bg-red-100 text-red-800 border-red-200" },
};

export function hasFinancesData(lead: LeadDetail): boolean {
  return !!(
    lead.chiffre_affaires != null ||
    lead.resultat_net != null ||
    lead.ca_last != null ||
    lead.ebe != null ||
    lead.marge_ebe != null ||
    lead.marge_ebe_pct != null ||
    lead.bilan_date != null ||
    lead.secteur_final != null ||
    lead.ca_trend_3y ||
    lead.profitability_tag
  );
}

export function FinancesSection({ lead }: { lead: LeadDetail }) {
  const rows: { label: string; value: string }[] = [];

  // Prefer INPI ca_last over chiffre_affaires (more recent / reliable)
  if (lead.ca_last != null) {
    rows.push({ label: "CA (INPI)", value: `${formatCA(Number(lead.ca_last))}${lead.ca_last_year ? ` (${lead.ca_last_year})` : ""}` });
  } else if (lead.chiffre_affaires != null) {
    rows.push({ label: "Chiffre d'affaires", value: formatCA(Number(lead.chiffre_affaires)) });
  }
  if (lead.ca_growth_pct_3y != null) {
    const pct = lead.ca_growth_pct_3y;
    rows.push({ label: "Variation CA 3 ans", value: `${pct > 0 ? "+" : ""}${pct}%` });
  }
  if (lead.resultat_net != null) rows.push({ label: "Resultat net", value: formatCA(Number(lead.resultat_net)) });
  if (lead.ebe != null) rows.push({ label: "EBE", value: formatCA(Number(lead.ebe)) });
  if (lead.marge_ebe_pct != null) {
    rows.push({ label: "Marge EBE", value: `${lead.marge_ebe_pct.toFixed(1)}%` });
  } else if (lead.marge_ebe != null) {
    rows.push({ label: "Marge EBE", value: `${(lead.marge_ebe * 100).toFixed(1)}%` });
  }
  if (lead.charges_personnel != null) rows.push({ label: "Charges personnel", value: formatCA(Number(lead.charges_personnel)) });
  if (lead.bilan_last_year != null) {
    rows.push({ label: "Dernier bilan", value: String(lead.bilan_last_year) });
  } else if (lead.bilan_date) {
    try {
      const d = new Date(lead.bilan_date);
      rows.push({ label: "Date du bilan", value: d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) });
    } catch { /* ignore */ }
  } else if (lead.annee_comptes != null) {
    rows.push({ label: "Annee des comptes", value: String(lead.annee_comptes) });
  }
  if (lead.inpi_nb_exercices != null && lead.inpi_nb_exercices > 0) {
    rows.push({ label: "Exercices INPI", value: `${lead.inpi_nb_exercices} bilan${lead.inpi_nb_exercices > 1 ? "s" : ""}` });
  }

  // Trend + profitability + signals badges
  const trend = lead.ca_trend_3y ? CA_TREND_LABELS[lead.ca_trend_3y] : null;
  const profit = lead.profitability_tag ? PROFITABILITY_LABELS[lead.profitability_tag] : null;

  return (
    <div className="space-y-3" data-testid="finances-section">
      {/* Financial metrics grid */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium font-mono">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* INPI signal badges */}
      {(trend || profit || lead.deficit_2y || lead.scaling_rh || lead.bilan_confidentiality) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {trend && (
            <Badge className={`text-[10px] ${trend.color}`}>{trend.label}</Badge>
          )}
          {profit && (
            <Badge className={`text-[10px] ${profit.color}`}>{profit.label}</Badge>
          )}
          {lead.deficit_2y && (
            <Badge className="text-[10px] bg-red-100 text-red-800 border-red-300">Deficit 2 ans</Badge>
          )}
          {lead.scaling_rh && (
            <Badge className="text-[10px] bg-teal-100 text-teal-800 border-teal-200">Scaling RH</Badge>
          )}
          {lead.bilan_confidentiality && lead.bilan_confidentiality.toLowerCase() !== "public" && (
            <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-300">Bilan {lead.bilan_confidentiality.toLowerCase()}</Badge>
          )}
        </div>
      )}

      {/* INPI history mini-table */}
      {lead.inpi_nb_exercices != null && lead.inpi_nb_exercices > 1 && lead.siren && (
        <InpiHistoryMini siren={lead.siren} />
      )}

      {/* Secteur */}
      {lead.secteur_final && (
        <div className="flex items-center gap-1.5 pt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">Secteur:</span>
          <Badge variant="outline" className="text-[10px]">{lead.secteur_final}</Badge>
          {lead.domaine_final && <Badge variant="outline" className="text-[10px]">{lead.domaine_final}</Badge>}
          {lead.confiance_secteur != null && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden inline-block">
                <span
                  className={`block h-full rounded-full ${lead.confiance_secteur >= 80 ? "bg-green-500" : lead.confiance_secteur >= 50 ? "bg-amber-500" : "bg-red-400"}`}
                  style={{ width: `${lead.confiance_secteur}%` }}
                />
              </span>
              {lead.confiance_secteur}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// --- INPI History mini-table (lazy loaded per lead) ---

function InpiHistoryMini({ siren }: { siren: string }) {
  const [history, setHistory] = useState<{ annee: number; ca_net: number | null; resultat_net: number | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leads/${encodeURIComponent(siren)}/history`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (!cancelled && Array.isArray(data)) setHistory(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siren]);

  if (loading) return <div className="text-[10px] text-muted-foreground pt-1">Chargement historique...</div>;
  if (history.length === 0) return null;

  // Show last 5 years, chronological order
  const recent = history.slice(0, 5).reverse();
  const maxCa = Math.max(...recent.map(h => Math.abs(h.ca_net ?? 0)), 1);

  return (
    <div className="pt-2 space-y-1">
      <span className="text-[10px] text-muted-foreground font-medium">Historique CA ({recent.length} ans)</span>
      <div className="flex items-end gap-1 h-12">
        {recent.map((h) => {
          const ca = h.ca_net ?? 0;
          const pct = Math.max(4, (Math.abs(ca) / maxCa) * 100);
          const isNeg = ca < 0;
          return (
            <div key={h.annee} className="flex flex-col items-center gap-0.5 flex-1 min-w-0" title={`${h.annee}: ${formatCA(ca)}`}>
              <div
                className={`w-full rounded-t ${isNeg ? "bg-red-400" : "bg-indigo-400"}`}
                style={{ height: `${pct}%` }}
              />
              <span className="text-[8px] text-muted-foreground">{String(h.annee).slice(2)}</span>
            </div>
          );
        })}
      </div>
      {/* Mini table under the bars */}
      <div className="grid gap-0.5">
        {recent.map((h) => (
          <div key={h.annee} className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">{h.annee}</span>
            <span className="font-mono">{h.ca_net != null ? formatCA(h.ca_net) : "-"}</span>
            <span className={`font-mono ${(h.resultat_net ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>
              {h.resultat_net != null ? formatCA(h.resultat_net) : "-"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Sites web Section (multi-domains) ---

type WebDomainEntry = {
  domain: string;
  cms?: string | null;
  has_https?: string | number | boolean | null;
  is_primary?: boolean;
  tech_score?: string | number | null;
  obsolescence_score?: string | number | null;
};

function parseWebDomains(raw: unknown): WebDomainEntry[] {
  if (!raw) return [];
  // Postgres JSONB is returned as parsed array already
  if (Array.isArray(raw)) return raw as WebDomainEntry[];
  // Defensive: stringified JSON
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

export function hasSitesData(lead: LeadDetail): boolean {
  const domains = parseWebDomains((lead as unknown as Record<string, unknown>).web_domains_all);
  return domains.length > 1 || !!lead.web_domain;
}

export function SitesSection({ lead }: { lead: LeadDetail }) {
  const domains = parseWebDomains((lead as unknown as Record<string, unknown>).web_domains_all);

  if (domains.length <= 1) {
    // Simple fallback: primary web_domain only
    if (!lead.web_domain) return null;
    return (
      <div className="space-y-2" data-testid="sites-section">
        <a
          href={webHref(lead.web_domain, lead.web_domains_all)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline break-all"
        >
          <Globe className="h-3.5 w-3.5 shrink-0" />
          {lead.web_domain}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      </div>
    );
  }

  // Sort: primary first, then by tech_score desc
  const sorted = [...domains].sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1;
    if (!a.is_primary && b.is_primary) return 1;
    const ta = Number(a.tech_score ?? 0);
    const tb = Number(b.tech_score ?? 0);
    return tb - ta;
  });

  return (
    <div className="space-y-2" data-testid="sites-section">
      <div className="text-[11px] text-muted-foreground">
        {sorted.length} sites web detectes
      </div>
      {sorted.map((d, i) => {
        const https = d.has_https === true || d.has_https === 1 || d.has_https === "1" || d.has_https === "true";
        const techScore = d.tech_score != null ? Number(d.tech_score) : null;
        return (
          <div key={`${d.domain}-${i}`} className="border rounded-md p-2 space-y-1">
            <div className="flex items-start gap-2">
              <a
                href={`${https ? "https" : "http"}://${d.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline flex-1 min-w-0 break-all inline-flex items-center gap-1"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{d.domain}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              {d.is_primary && (
                <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[9px] h-4 px-1">Principal</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {d.cms && <Badge variant="secondary" className="text-[9px] h-4 px-1">{d.cms}</Badge>}
              {https && <Badge variant="outline" className="text-[9px] h-4 px-1 text-green-700 border-green-200">HTTPS</Badge>}
              {!https && <Badge variant="outline" className="text-[9px] h-4 px-1 text-red-700 border-red-200">HTTP</Badge>}
              {techScore != null && (
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1 ${techScore >= 70 ? "text-green-700 border-green-200" : techScore >= 40 ? "text-amber-700 border-amber-200" : "text-red-700 border-red-200"}`}
                >
                  Tech {techScore}
                </Badge>
              )}
              {d.obsolescence_score != null && Number(d.obsolescence_score) > 0 && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 text-orange-700 border-orange-200">
                  Obsolescence {Number(d.obsolescence_score)}
                </Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Certifications Section ---

type CertDef = { key: keyof LeadDetail; label: string; color: string; detail?: string | null };

// TODO(inpi-v36): when a rge_domaines JSONB column lands, expand the RGE badge into
// a collapsible list of qualification domains. Today only a boolean est_rge exists —
// no sub-specialites available. Similarly, qualiopi_specialite is a scalar text, not
// an array; if a qualiopi_specialites (plural) JSONB is added later, switch the
// single-line label to a chip list.
export function hasCertificationsData(lead: LeadDetail): boolean {
  return !!(
    lead.est_rge ||
    lead.est_qualiopi ||
    lead.est_bio ||
    lead.est_epv ||
    lead.est_finess ||
    lead.est_ess ||
    lead.est_bni ||
    lead.est_sur_lbc
  );
}

export function CertificationsSection({ lead }: { lead: LeadDetail }) {
  const certs: CertDef[] = [];
  if (lead.est_rge) certs.push({ key: "est_rge", label: "RGE", color: "bg-green-100 text-green-800 border-green-200" });
  if (lead.est_qualiopi) certs.push({ key: "est_qualiopi", label: "Qualiopi", color: "bg-blue-100 text-blue-800 border-blue-200", detail: lead.qualiopi_specialite });
  if (lead.est_bio) certs.push({ key: "est_bio", label: "Bio", color: "bg-lime-100 text-lime-800 border-lime-200" });
  if (lead.est_epv) certs.push({ key: "est_epv", label: "EPV", color: "bg-amber-100 text-amber-800 border-amber-200" });
  if (lead.est_finess) certs.push({ key: "est_finess", label: "FINESS", color: "bg-cyan-100 text-cyan-800 border-cyan-200" });
  if (lead.est_ess) certs.push({ key: "est_ess", label: "ESS", color: "bg-purple-100 text-purple-800 border-purple-200" });
  if (lead.est_bni) certs.push({ key: "est_bni", label: "BNI", color: "bg-rose-100 text-rose-800 border-rose-200" });
  if (lead.est_sur_lbc) certs.push({ key: "est_sur_lbc", label: "LeBonCoin", color: "bg-orange-100 text-orange-800 border-orange-200" });

  if (certs.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="certifications-section">
      <div className="flex flex-wrap gap-1.5">
        {certs.map(c => (
          <Badge key={c.key as string} className={`text-[10px] ${c.color}`}>
            <Award className="h-3 w-3 mr-0.5" /> {c.label}
          </Badge>
        ))}
      </div>
      {lead.est_qualiopi && lead.qualiopi_specialite && (
        <div className="text-xs">
          <span className="text-muted-foreground">Specialite Qualiopi : </span>
          <span className="font-medium">{lead.qualiopi_specialite}</span>
        </div>
      )}
    </div>
  );
}

// --- Activite business Section ---

export function hasBusinessData(lead: LeadDetail): boolean {
  return !!(
    (lead.nb_marches_publics != null && lead.nb_marches_publics > 0) ||
    (lead.montant_marches_publics != null && lead.montant_marches_publics > 0) ||
    (lead.decp_2024_plus != null && lead.decp_2024_plus > 0) ||
    (lead.bodacc_status && lead.bodacc_status !== "")
  );
}

export function BusinessSection({ lead }: { lead: LeadDetail }) {
  const rows: { label: string; value: React.ReactNode }[] = [];

  if (lead.nb_marches_publics != null && lead.nb_marches_publics > 0) {
    rows.push({ label: "Marches publics", value: `${lead.nb_marches_publics} marche${lead.nb_marches_publics > 1 ? "s" : ""}` });
  }
  if (lead.montant_marches_publics != null && lead.montant_marches_publics > 0) {
    rows.push({ label: "Montant cumule", value: formatCA(Number(lead.montant_marches_publics)) });
  }
  if (lead.decp_2024_plus != null && lead.decp_2024_plus > 0) {
    rows.push({ label: "DECP depuis 2024", value: `${lead.decp_2024_plus} ligne${lead.decp_2024_plus > 1 ? "s" : ""}` });
  }

  return (
    <div className="space-y-2" data-testid="business-section">
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium font-mono">{value}</span>
            </div>
          ))}
        </div>
      )}
      {lead.bodacc_status && (
        <div className="flex items-start gap-1.5 pt-1">
          <ShieldAlert className="h-3.5 w-3.5 text-orange-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="text-muted-foreground">BODACC : </span>
            <Badge variant="outline" className="text-[10px] text-orange-700 border-orange-200">
              {formatBodaccStatus(lead.bodacc_status)}
            </Badge>
            {lead.bodacc_nb_procedures != null && lead.bodacc_nb_procedures > 0 && (
              <span className="ml-1 text-muted-foreground">({lead.bodacc_nb_procedures} procedure{lead.bodacc_nb_procedures > 1 ? "s" : ""})</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FollowupCard({ followup, onUpdate }: { followup: Followup; onUpdate: (id: number, status: string) => void }) {
  const isPending = followup.status === "pending";
  const isDone = followup.status === "done";
  const isCancelled = followup.status === "cancelled";
  const bgColor = isPending ? "bg-amber-50 border-amber-200" : isDone ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200";

  return (
    <div className={`border rounded-md p-2 flex items-start gap-2 ${bgColor}`}>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{new Date(followup.scheduled_at).toLocaleString("fr-FR")}</div>
        {followup.note && <div className="text-xs text-muted-foreground mt-0.5">{followup.note}</div>}
      </div>
      <div className="flex items-center gap-1">
        {isPending && (
          <>
            <Button size="sm" variant="ghost" onClick={() => onUpdate(followup.id, "done")} className="h-6 w-6 p-0" title="Fait"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /></Button>
            <Button size="sm" variant="ghost" onClick={() => onUpdate(followup.id, "cancelled")} className="h-6 w-6 p-0" title="Annuler"><XCircle className="h-3.5 w-3.5 text-red-600" /></Button>
          </>
        )}
        {(isDone || isCancelled) && (
          <Button size="sm" variant="ghost" onClick={() => onUpdate(followup.id, "pending")} className="h-6 gap-0.5 text-[10px]">Reactiver</Button>
        )}
      </div>
    </div>
  );
}
