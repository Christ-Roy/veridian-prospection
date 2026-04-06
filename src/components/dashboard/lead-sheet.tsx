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
import { Badge } from "@/components/ui/badge";
import { Building2, Phone, Wrench, Bell, Bot, BookOpen, MessageSquare, TrendingUp, Globe, Award, Briefcase } from "lucide-react";
import { toast } from "sonner";
import type { LeadDetail, ClaudeActivity, Followup } from "@/lib/types";
import { LeadHeader } from "./lead-sheet/lead-header";
import { AutoSaveNotes } from "./lead-sheet/auto-save-notes";
import {
  EntrepriseSection,
  ContactSection,
  TechniqueSection,
  PagesJaunesSection,
  ClaudeNotesSection,
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

  return (
    <Sheet open={!!domain} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>{lead?.nom_entreprise || domain}</SheetTitle>
        </SheetHeader>

        {loading && <div className="py-8 text-center text-muted-foreground">Chargement...</div>}

        {lead && !loading && (
          <div className="space-y-4">
            {/* Header - always visible */}
            <LeadHeader
              lead={lead}
              domain={domain!}
              onUpdated={onUpdated}
              onDismiss={handleDismiss}
            />

            {/* Accordion sections */}
            <Accordion
              type="multiple"
              defaultValue={["entreprise", "contact"]}
              className="w-full"
            >
              {/* Pages Jaunes (PJ leads only) */}
              {lead.is_pj_lead && (
                <AccordionItem value="pagesjaunes">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-yellow-600">
                      <BookOpen className="h-4 w-4" /> Pages Jaunes
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <PagesJaunesSection lead={lead} />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Entreprise */}
              <AccordionItem value="entreprise">
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex items-center gap-2 text-blue-600">
                    <Building2 className="h-4 w-4" /> Entreprise
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <EntrepriseSection lead={lead} />
                </AccordionContent>
              </AccordionItem>

              {/* Contact */}
              <AccordionItem value="contact">
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex items-center gap-2 text-green-600">
                    <Phone className="h-4 w-4" /> Contact
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ContactSection lead={lead} />
                </AccordionContent>
              </AccordionItem>

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

              {/* Certifications */}
              {hasCertificationsData(lead) && (
                <AccordionItem value="certifications">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-lime-600">
                      <Award className="h-4 w-4" /> Certifications
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <CertificationsSection lead={lead} />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Sites web */}
              {hasSitesData(lead) && (
                <AccordionItem value="sites">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-sky-600">
                      <Globe className="h-4 w-4" /> Sites web
                      {lead.web_domain_count != null && lead.web_domain_count > 1 && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{lead.web_domain_count}</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <SitesSection lead={lead} />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Activite business */}
              {hasBusinessData(lead) && (
                <AccordionItem value="business">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-indigo-600">
                      <Briefcase className="h-4 w-4" /> Activite business
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <BusinessSection lead={lead} />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Technique */}
              <AccordionItem value="technique">
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex items-center gap-2 text-orange-600">
                    <Wrench className="h-4 w-4" /> Technique
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <TechniqueSection lead={lead} />
                </AccordionContent>
              </AccordionItem>

              {/* Notes & historique */}
              <AccordionItem value="notes">
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex items-center gap-2 text-rose-600">
                    <MessageSquare className="h-4 w-4" /> Notes
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <AutoSaveNotes
                    domain={domain!}
                    initialNotes={lead.outreach_notes || ""}
                    onSaved={onUpdated}
                  />
                </AccordionContent>
              </AccordionItem>

              {/* Follow-ups */}
              <AccordionItem value="followups">
                <AccordionTrigger className="py-3 text-sm">
                  <span className="flex items-center gap-2 text-amber-600">
                    <Bell className="h-4 w-4" /> Follow-ups
                    {pendingFollowups > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{pendingFollowups}</Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <FollowupSection
                    followups={followups}
                    onAdd={handleAddFollowup}
                    onUpdate={handleUpdateFollowup}
                  />
                </AccordionContent>
              </AccordionItem>

              {/* Claude Notes */}
              {claudeActivities.length > 0 && (
                <AccordionItem value="claude">
                  <AccordionTrigger className="py-3 text-sm">
                    <span className="flex items-center gap-2 text-cyan-600">
                      <Bot className="h-4 w-4" /> Notes Claude
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">{claudeActivities.length}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ClaudeNotesSection
                      activities={claudeActivities}
                      domain={domain!}
                      onUpdate={refreshClaude}
                    />
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
