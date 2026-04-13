"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, MessageSquare, Bell, FileText, Globe, ExternalLink, ShieldAlert, Smartphone, Copyright, Linkedin, Facebook, Instagram } from "lucide-react";
import { toast } from "sonner";
import type { LeadDetail, ClaudeActivity, Followup } from "@/lib/types";
import { formatEffectifs, formatCA } from "@/lib/types";
import { webHref } from "@/lib/utils";
import { LeadHeader } from "./lead-sheet/lead-header";
import { AutoSaveNotes } from "./lead-sheet/auto-save-notes";
import {
  EntrepriseSection,
  ContactSection,
  TechniqueSection,
  PagesJaunesSection,
  FollowupSection,
  FinancesSection,
  SitesSection,
  CertificationsSection,
  BusinessSection,
  hasFinancesData,
  hasSitesData,
  hasCertificationsData,
  hasBusinessData,
} from "./lead-sheet/sections";

/** Format phone: 0629414311 → 06 29 41 43 11 */
function formatPhone(phone: string): string {
  const clean = phone.replace(/[^0-9+]/g, "");
  // French mobile/fixe: +33XXXXXXXXX or 0XXXXXXXXX
  if (clean.startsWith("+33") && clean.length === 12) {
    const local = "0" + clean.slice(3);
    return local.replace(/(\d{2})(?=\d)/g, "$1 ");
  }
  if (clean.startsWith("0") && clean.length === 10) {
    return clean.replace(/(\d{2})(?=\d)/g, "$1 ");
  }
  return phone;
}

function safeParseArray(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

interface LeadSheetProps {
  domain: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export function LeadSheet({ domain, onClose, onUpdated }: LeadSheetProps) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [claudeActivities, setClaudeActivities] = useState<ClaudeActivity[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);

  useEffect(() => {
    if (!domain) {
      setLead(null);
      setClaudeActivities([]);
      setFollowups([]);
      return;
    }
    setLoading(true);
    fetch(`/api/leads/${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d) => { setLead(d); setLoading(false); })
      .catch(() => setLoading(false));

    fetch(`/api/claude/${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d) => setClaudeActivities(Array.isArray(d) ? d : []))
      .catch(() => {});

    fetch(`/api/followups?domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d) => setFollowups(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [domain]);

  function refreshClaude() {
    if (!domain) return;
    fetch(`/api/claude/${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d) => setClaudeActivities(Array.isArray(d) ? d : []))
      .catch(() => {});
    onUpdated();
  }

  async function handleAddFollowup(scheduled_at: string, note: string) {
    if (!domain) return;
    const toastId = toast.loading("Ajout du follow-up...");
    try {
      const res = await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, scheduled_at, note }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success("Follow-up ajoute", { id: toastId });
        setFollowups([...followups, result]);
      } else {
        toast.error(result.error || "Erreur", { id: toastId });
      }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    }
  }

  async function handleUpdateFollowup(id: number, status: string) {
    const toastId = toast.loading("Mise a jour...");
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success("Follow-up mis a jour", { id: toastId });
        setFollowups(followups.map(f => f.id === id ? { ...f, status: status as "pending" | "done" | "cancelled" } : f));
      } else {
        toast.error("Erreur", { id: toastId });
      }
    } catch (e) {
      toast.error(`Erreur: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    }
  }

  function handleDismiss() {
    onUpdated();
    onClose();
  }

  const pendingFollowups = followups.filter(f => f.status === "pending").length;

  // Determine which accordion sections to open by default
  const defaultSections: string[] = [];
  // Notes open first if there's a note
  if (lead?.outreach_notes) defaultSections.push("notes");
  if (lead && hasFinancesData(lead)) defaultSections.push("finances");
  if (!lead?.outreach_notes && !lead?.outreach_notes && !hasFinancesData(lead ?? {} as LeadDetail)) defaultSections.push("notes");

  return (
    <Sheet open={!!domain} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto px-6">
        <SheetHeader className="sr-only">
          <SheetTitle>{lead?.nom_entreprise || domain}</SheetTitle>
        </SheetHeader>

        {loading && <div className="py-8 text-center text-muted-foreground">Chargement...</div>}

        {lead && !loading && (
          <div className="space-y-4">
            {/* Header — nom, status, action buttons */}
            <LeadHeader
              lead={lead}
              domain={domain!}
              onUpdated={onUpdated}
              onDismiss={handleDismiss}
            />

            {/* ========== ALERTE BODACC ========== */}
            {lead.bodacc_status && ["liquidation", "redressement", "sauvegarde"].includes(lead.bodacc_status.toLowerCase()) && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${
                lead.bodacc_status.toLowerCase() === "liquidation"
                  ? "bg-red-100 text-red-800 border border-red-300"
                  : lead.bodacc_status.toLowerCase() === "redressement"
                  ? "bg-orange-100 text-orange-800 border border-orange-300"
                  : "bg-yellow-100 text-yellow-800 border border-yellow-300"
              }`}>
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {lead.bodacc_status.toLowerCase() === "liquidation" && "Societe en liquidation judiciaire"}
                {lead.bodacc_status.toLowerCase() === "redressement" && "Societe en redressement judiciaire"}
                {lead.bodacc_status.toLowerCase() === "sauvegarde" && "Societe en procedure de sauvegarde"}
              </div>
            )}

            {/* ========== VUE D'ENSEMBLE — Cards ========== */}
            <TooltipProvider delayDuration={200}>
              <div className="space-y-3">

                {/* ROW 1 : Domaine d'activité + Secteur */}
                {(lead.secteur_final || lead.code_naf) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {lead.secteur_final && (
                      <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg">{lead.secteur_final}</span>
                    )}
                    {lead.domaine_final && (
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{lead.domaine_final}</span>
                    )}
                    {lead.code_naf && (
                      <span className="text-[10px] text-muted-foreground font-mono">NAF {lead.code_naf}</span>
                    )}
                  </div>
                )}

                {/* ROW 2 : 2 cards cote a cote, responsive */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                  {/* CARD CONTACT */}
                  <div className="border rounded-xl bg-white p-4 space-y-3 shadow-sm">
                    {/* Telephone */}
                    {lead.phone ? (
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Telephone</span>
                        <a href={`tel:${lead.phone}`} className="block text-lg font-bold tracking-wide text-green-700 hover:text-green-800 transition-colors">
                          {formatPhone(lead.phone)}
                        </a>
                        {lead.phone_type && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            lead.phone_type === "mobile" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                          }`}>{lead.phone_type}{lead.phone_carrier ? ` — ${lead.phone_carrier}` : ""}</span>
                        )}
                      </div>
                    ) : (
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Telephone</span>
                        <p className="text-sm text-muted-foreground italic">Non renseigne</p>
                      </div>
                    )}

                    {/* Telephones secondaires */}
                    {lead.phones && lead.phones !== "[]" && (() => {
                      const allPhones = safeParseArray(lead.phones);
                      const others = allPhones.filter(t => t !== lead.phone);
                      if (others.length === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {others.map(tel => (
                            <a key={tel} href={`tel:${tel}`} className="text-xs bg-slate-50 text-slate-700 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors">{formatPhone(tel)}</a>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Emails */}
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Emails</span>
                      <div className="flex flex-col gap-1 mt-0.5">
                        {lead.dirigeant_emails_all && lead.dirigeant_emails_all !== "[]" ? (
                          safeParseArray(lead.dirigeant_emails_all).map(email => (
                            <a key={email} href={`mailto:${email}`} className="text-sm bg-green-50 text-green-700 px-2 py-1 rounded-md hover:bg-green-100 font-medium transition-colors w-fit">{email}</a>
                          ))
                        ) : lead.dirigeant_email ? (
                          <a href={`mailto:${lead.dirigeant_email}`} className="text-sm bg-green-50 text-green-700 px-2 py-1 rounded-md hover:bg-green-100 font-medium transition-colors w-fit">{lead.dirigeant_email}</a>
                        ) : null}
                        {lead.emails && lead.emails !== "[]" ? (
                          safeParseArray(lead.emails).map(email => (
                            <a key={email} href={`mailto:${email}`} className="text-sm bg-slate-50 text-slate-600 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors w-fit">{email}</a>
                          ))
                        ) : lead.email && lead.email !== lead.dirigeant_email ? (
                          <a href={`mailto:${lead.email}`} className="text-sm bg-slate-50 text-slate-600 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors w-fit">{lead.email}</a>
                        ) : null}
                        {!lead.dirigeant_email && !lead.email && (!lead.dirigeant_emails_all || lead.dirigeant_emails_all === "[]") && (!lead.emails || lead.emails === "[]") && (
                          <p className="text-sm text-muted-foreground italic">Aucun email</p>
                        )}
                      </div>
                    </div>

                    {/* Dirigeant */}
                    {lead.dirigeant && (
                      <div className="pt-2 border-t">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Dirigeant</span>
                        <p className="text-sm font-semibold">
                          {lead.dirigeant}
                          {lead.dirigeant_date_naissance && (() => {
                            const [y, m] = lead.dirigeant_date_naissance!.split("-").map(Number);
                            const moisNoms = ["", "janv.", "fev.", "mars", "avr.", "mai", "juin", "juil.", "aout", "sept.", "oct.", "nov.", "dec."];
                            const age = new Date().getFullYear() - y - (new Date().getMonth() + 1 < m ? 1 : 0);
                            return (
                              <span className="text-xs text-muted-foreground font-normal ml-2">
                                {age} ans{m ? ` (${moisNoms[m]} ${y})` : ""}
                              </span>
                            );
                          })()}
                        </p>
                        {lead.qualite_dirigeant && <p className="text-xs text-muted-foreground">{lead.qualite_dirigeant}</p>}
                        {lead.date_creation && (
                          <p className="text-xs text-muted-foreground">
                            Creation {new Date().getFullYear() - new Date(lead.date_creation).getFullYear()} ans ({new Date(lead.date_creation).getFullYear()})
                          </p>
                        )}
                      </div>
                    )}

                    {/* Reseaux sociaux */}
                    {(lead.social_linkedin || lead.social_facebook || lead.social_instagram) && (
                      <div className="pt-2 border-t flex items-center gap-2 flex-wrap">
                        {lead.social_linkedin && (
                          <a href={lead.social_linkedin} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium">
                            <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                          </a>
                        )}
                        {lead.social_facebook && (
                          <a href={lead.social_facebook} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium">
                            <Facebook className="h-3.5 w-3.5" /> Facebook
                          </a>
                        )}
                        {lead.social_instagram && (
                          <a href={lead.social_instagram} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-pink-50 text-pink-600 hover:bg-pink-100 transition-colors font-medium">
                            <Instagram className="h-3.5 w-3.5" /> Instagram
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* CARD ENTREPRISE + WEB */}
                  <div className="border rounded-xl bg-white p-4 space-y-3 shadow-sm">
                    {/* Sites web */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Site web</span>
                        {lead.web_agency && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300 font-semibold cursor-help">
                                {String(lead.web_agency)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <p className="font-semibold">Prestataire web concurrent identifie</p>
                              <p className="mt-1">Ce client paye actuellement un prestataire pour son site web. C&apos;est un prospect chaud — il a deja un budget site web et connait la valeur du service.</p>
                              {String(lead.web_agency).includes("Solocal") && (
                                <p className="mt-1 text-orange-600">Solocal/Local.fr : sites Duda basiques, forfaits de 80 a 355 EUR/mois. Les clients sont souvent insatisfaits du rapport qualite/prix.</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {lead.web_domains_all && Array.isArray(lead.web_domains_all) && lead.web_domains_all.length > 0 ? (
                        <div className="flex flex-col gap-1.5 mt-1">
                          {lead.web_domains_all.map((site) => (
                            <div key={site.domain} className="flex items-center gap-2">
                              <a href={site.has_https ? `https://${site.domain}` : `http://${site.domain}`} target="_blank" rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1">
                                {site.domain} <ExternalLink className="h-3 w-3" />
                              </a>
                              {site.tech_score != null && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                                  Number(site.tech_score) >= 70 ? "bg-red-100 text-red-700" :
                                  Number(site.tech_score) >= 40 ? "bg-orange-100 text-orange-700" :
                                  "bg-green-100 text-green-700"
                                }`}>dette:{site.tech_score}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : lead.web_domain ? (
                        <a href={webHref(lead.web_domain, lead.web_domains_all)} target="_blank" rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1 mt-1">
                          {lead.web_domain} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground italic mt-1">Aucun site</p>
                      )}
                    </div>

                    {/* Indicateurs techniques */}
                    <div className="flex flex-wrap gap-1.5">
                      {!lead.has_https && lead.web_domain && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium cursor-help">
                              <ShieldAlert className="h-3 w-3" /> Non securise
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <p className="font-semibold">Site non HTTPS (HTTP seulement)</p>
                            <p className="mt-1">Le referencement Google est penalise car le site n&apos;est pas securise. Les donnees echangees entre le navigateur et le site (formulaires, mots de passe) sont lisibles par quiconque sur le reseau.</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {lead.has_https === 1 && lead.web_domain && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-green-100 text-green-700"><ShieldAlert className="h-3 w-3" /> HTTPS</span>
                      )}
                      {!lead.has_responsive && lead.web_domain && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium cursor-help">
                              <Smartphone className="h-3 w-3" /> Non mobile
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <p className="font-semibold">Site non adapte aux mobiles</p>
                            <p className="mt-1">Le site n&apos;a pas de viewport responsive. Il s&apos;affiche mal sur telephone et tablette. Google penalise fortement ces sites dans les resultats de recherche mobile (60%+ du trafic web).</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {lead.has_responsive === 1 && lead.web_domain && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-green-100 text-green-700"><Smartphone className="h-3 w-3" /> Mobile OK</span>
                      )}
                      {lead.copyright_year && lead.web_domain && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full cursor-help ${
                              lead.copyright_year < new Date().getFullYear() - 3 ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"
                            }`}><Copyright className="h-3 w-3" /> {lead.copyright_year}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            {lead.copyright_year < new Date().getFullYear() - 3
                              ? <p>Copyright datant de {lead.copyright_year} — le site n&apos;a probablement pas ete mis a jour depuis {new Date().getFullYear() - lead.copyright_year} ans.</p>
                              : <p>Copyright {lead.copyright_year} — site relativement recent.</p>
                            }
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {lead.cms && <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600">{lead.cms}</span>}
                    </div>

                    {/* Chiffres cles */}
                    <div className="pt-2 border-t grid grid-cols-3 gap-2">
                      {lead.effectifs && (
                        <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                          <span className="text-[9px] uppercase text-muted-foreground block">Effectifs</span>
                          <p className="text-xs font-bold">{formatEffectifs(lead.effectifs)}</p>
                        </div>
                      )}
                      {(() => {
                        const caVal = lead.ca ?? lead.chiffre_affaires;
                        if (caVal != null) return (
                          <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                            <span className="text-[9px] uppercase text-muted-foreground block">CA</span>
                            <p className="text-xs font-bold">{formatCA(caVal)}</p>
                            {lead.ca_growth_pct_3y != null && (
                              <span className={`text-[9px] ${lead.ca_growth_pct_3y > 0 ? "text-green-600" : lead.ca_growth_pct_3y < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                {lead.ca_growth_pct_3y > 0 ? "+" : ""}{lead.ca_growth_pct_3y}%
                              </span>
                            )}
                          </div>
                        );
                        if (lead.resultat_net != null) return (
                          <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                            <span className="text-[9px] uppercase text-muted-foreground block">Resultat</span>
                            <p className={`text-xs font-bold ${(lead.resultat_net ?? 0) < 0 ? "text-red-600" : ""}`}>{formatCA(lead.resultat_net!)}</p>
                          </div>
                        );
                        return null;
                      })()}
                      {lead.nombre_etablissements != null && lead.nombre_etablissements > 1 ? (
                        <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                          <span className="text-[9px] uppercase text-muted-foreground block">Etab.</span>
                          <p className="text-xs font-bold">{lead.nombre_etablissements_ouverts ?? lead.nombre_etablissements} / {lead.nombre_etablissements}</p>
                        </div>
                      ) : lead.marge_ebe_pct != null ? (
                        <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                          <span className="text-[9px] uppercase text-muted-foreground block">Marge</span>
                          <p className={`text-xs font-bold ${lead.marge_ebe_pct < 5 ? "text-orange-600" : lead.marge_ebe_pct > 15 ? "text-green-600" : ""}`}>{lead.marge_ebe_pct.toFixed(1)}%</p>
                        </div>
                      ) : null}
                    </div>

                    {/* Adresse */}
                    {(lead.ville || lead.api_adresse || lead.address) && (
                      <div className="pt-2 border-t">
                        <p className="text-xs">{lead.api_adresse || lead.address}</p>
                        <p className="text-xs font-medium">{[lead.ville, lead.code_postal].filter(Boolean).join(" ")}</p>
                      </div>
                    )}

                    {/* SIREN + infos legales */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="font-mono">SIREN {lead.siren || domain}</span>
                      {lead.siret && <span className="font-mono">SIRET {lead.siret}</span>}
                      {lead.etat_administratif === "F" && (
                        <span className="text-red-600 font-semibold">FERMEE{lead.date_fermeture ? ` le ${new Date(lead.date_fermeture).toLocaleDateString("fr-FR")}` : ""}</span>
                      )}
                      {lead.convention_collective && <span>CC: {lead.convention_collective}</span>}
                    </div>
                  </div>
                </div>
              </div>
            </TooltipProvider>

            {/* ========== SECTIONS DEPLIABLES ========== */}
            <Accordion
              type="multiple"
              defaultValue={defaultSections}
              className="w-full"
            >
              {/* Notes — FIRST if note exists, so commercial sees it immediately */}
              {lead.outreach_notes && (
                <AccordionItem value="notes">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-rose-600">
                      <MessageSquare className="h-4 w-4" /> Notes
                      {pendingFollowups > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{pendingFollowups} rappel{pendingFollowups > 1 ? "s" : ""}</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4">
                      <AutoSaveNotes
                        domain={domain!}
                        initialNotes={lead.outreach_notes || ""}
                        onSaved={onUpdated}
                      />
                      {followups.length > 0 && (
                        <div className="pt-3 border-t">
                          <h4 className="text-xs font-medium text-amber-600 mb-2 flex items-center gap-1">
                            <Bell className="h-3 w-3" /> Follow-ups
                          </h4>
                          <FollowupSection
                            followups={followups}
                            onAdd={handleAddFollowup}
                            onUpdate={handleUpdateFollowup}
                          />
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Finances & Secteur */}
              {hasFinancesData(lead) && (
                <AccordionItem value="finances">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-emerald-600">
                      <TrendingUp className="h-4 w-4" /> Finances & Secteur
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <FinancesSection lead={lead} />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Notes — after Finances if no existing note */}
              {!lead.outreach_notes && (
                <AccordionItem value="notes">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-rose-600">
                      <MessageSquare className="h-4 w-4" /> Notes
                      {pendingFollowups > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{pendingFollowups} rappel{pendingFollowups > 1 ? "s" : ""}</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4">
                      <AutoSaveNotes
                        domain={domain!}
                        initialNotes=""
                        onSaved={onUpdated}
                      />
                      <div className="pt-3 border-t">
                        <h4 className="text-xs font-medium text-amber-600 mb-2 flex items-center gap-1">
                          <Bell className="h-3 w-3" /> Follow-ups
                        </h4>
                        <FollowupSection
                          followups={followups}
                          onAdd={handleAddFollowup}
                          onUpdate={handleUpdateFollowup}
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Tous les détails */}
              <AccordionItem value="details">
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex items-center gap-2 text-slate-500">
                    <FileText className="h-4 w-4" /> Details complets
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    {/* PJ */}
                    {lead.is_pj_lead && (
                      <div>
                        <h4 className="text-xs font-medium text-yellow-600 mb-1">Pages Jaunes</h4>
                        <PagesJaunesSection lead={lead} />
                      </div>
                    )}
                    {/* Entreprise complet */}
                    <div>
                      <h4 className="text-xs font-medium text-blue-600 mb-1">Entreprise</h4>
                      <EntrepriseSection lead={lead} />
                    </div>
                    {/* Contact complet */}
                    <div>
                      <h4 className="text-xs font-medium text-green-600 mb-1">Contact</h4>
                      <ContactSection lead={lead} />
                    </div>
                    {/* Certifications */}
                    {hasCertificationsData(lead) && (
                      <div>
                        <h4 className="text-xs font-medium text-lime-600 mb-1">Certifications</h4>
                        <CertificationsSection lead={lead} />
                      </div>
                    )}
                    {/* Sites */}
                    {hasSitesData(lead) && (
                      <div>
                        <h4 className="text-xs font-medium text-sky-600 mb-1">Sites web</h4>
                        <SitesSection lead={lead} />
                      </div>
                    )}
                    {/* Business */}
                    {hasBusinessData(lead) && (
                      <div>
                        <h4 className="text-xs font-medium text-indigo-600 mb-1">Activite business</h4>
                        <BusinessSection lead={lead} />
                      </div>
                    )}
                    {/* Technique */}
                    <div>
                      <h4 className="text-xs font-medium text-orange-600 mb-1">Technique</h4>
                      <TechniqueSection lead={lead} />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
