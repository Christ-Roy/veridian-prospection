"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { webHref } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PIPELINE_STAGES } from "@/lib/types";
import type { LeadDetail } from "@/lib/types";
import { toast } from "sonner";
import {
  Building2,
  ExternalLink,
  Globe,
  Mail,
  Trash2,
  BookOpen,
  Eye,
} from "lucide-react";
import { formatTimeAgo } from "@/lib/types";
import { GoogleMapsDropdown } from "./google-maps-dropdown";
import { QuickNotes } from "./quick-notes";
import { StageTransitionModal, type StageData } from "./stage-transition";
import { Phone as PhoneIcon } from "lucide-react";

interface LeadHeaderProps {
  lead: LeadDetail;
  domain: string;
  onUpdated: () => void;
  onDismiss: () => void;
}

export function LeadHeader({ lead, domain, onUpdated, onDismiss }: LeadHeaderProps) {
  const [status, setStatus] = useState(lead.pipeline_stage || lead.outreach_status || "a_contacter");
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [pendingStage, setPendingStage] = useState<string | null>(null);


  function handleStatusChange(val: string) {
    // Always open the transition modal
    setPendingStage(val);
    setTransitionOpen(true);
  }

  async function handleTransitionConfirm(data: StageData) {
    const prev = status;
    setStatus(data.pipeline_stage);
    setTransitionOpen(false);
    setPendingStage(null);

    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(domain)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: data.pipeline_stage,
          ...data,
          notes: data.notes || undefined,
        }),
      });
      if (!res.ok) {
        setStatus(prev);
        toast.error("Erreur mise a jour statut");
        return;
      }
      toast.success("Statut mis a jour");

      // Creer un Appointment pour les stages avec RDV + ouvrir Google Calendar
      const createsAppointment =
        (data.pipeline_stage === "a_rappeler" || data.pipeline_stage === "site_demo") &&
        data.deadline;

      if (createsAppointment && lead.siren) {
        const start = new Date(data.deadline!);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const entreprise = lead.nom_entreprise || domain;
        const title =
          data.pipeline_stage === "a_rappeler"
            ? `Rappel ${entreprise}`
            : `Demo site — ${entreprise}`;
        const details = [
          lead.dirigeant ? `Dirigeant: ${lead.dirigeant}` : null,
          lead.phone ? `Tel: ${lead.phone}` : null,
          lead.email || lead.dirigeant_email ? `Email: ${lead.dirigeant_email || lead.email}` : null,
          data.notes ? `Notes: ${data.notes}` : null,
        ].filter(Boolean).join("\n");

        try {
          const apptRes = await fetch("/api/appointments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siren: lead.siren,
              startAt: start.toISOString(),
              endAt: end.toISOString(),
              title,
              notes: details,
              sourceStage: data.pipeline_stage,
            }),
          });
          if (apptRes.ok) {
            const json = await apptRes.json();
            if (json.appointment?.googleEventUrl) {
              window.open(json.appointment.googleEventUrl, "_blank", "noopener,noreferrer");
            }
          }
        } catch {
          // RDV cree en DB meme si l'URL Google echoue — on ne bloque pas
        }
      }
    } catch {
      setStatus(prev);
      toast.error("Erreur reseau");
    }
  }

  function handleTransitionCancel() {
    setTransitionOpen(false);
    setPendingStage(null);
  }

  async function handleDismiss() {
    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(domain)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "hors_cible" }),
      });
      if (res.ok) {
        toast.success("Marque hors cible");
        onDismiss();
      } else {
        toast.error("Erreur");
      }
    } catch {
      toast.error("Erreur reseau");
    }
  }

  return (
    <div className="space-y-3 pt-3">
      {/* Title + domain */}
      <div>
        <div className="flex items-center gap-2">
          {lead.is_pj_lead ? (
            <BookOpen className="h-5 w-5 text-yellow-600 shrink-0" />
          ) : (
            <Building2 className="h-5 w-5 shrink-0" />
          )}
          <h2 className="text-lg font-bold leading-tight truncate">
            {lead.nom_entreprise || domain}
          </h2>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {lead.is_pj_lead && lead.pj_website_url ? (
            <a
              href={lead.pj_website_url.startsWith("http") ? lead.pj_website_url : `https://${lead.pj_website_url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              <Globe className="h-3 w-3" />
              {lead.pj_website_url.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : !lead.is_pj_lead && lead.web_domain ? (
            <a
              href={webHref(lead.web_domain, lead.web_domains_all)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              {lead.web_domain} <ExternalLink className="h-3 w-3" />
            </a>
          ) : !lead.is_pj_lead ? (
            <button
              className="text-xs text-muted-foreground font-mono hover:text-foreground transition-colors inline-flex items-center gap-1"
              onClick={() => {
                navigator.clipboard.writeText(domain);
                // Import toast dynamically to avoid circular deps
                import("sonner").then(({ toast }) => toast.success("SIREN copie"));
              }}
              title="Cliquer pour copier le SIREN"
            >
              SIREN {domain} <span className="text-[10px]">📋</span>
            </button>
          ) : null}
          {lead.is_pj_lead && lead.pj_url && (
            <a
              href={lead.pj_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-yellow-700 hover:underline flex items-center gap-1"
            >
              <BookOpen className="h-3 w-3" /> PJ <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {lead.niveau && (
            <Badge
              variant="outline"
              className={
                lead.niveau === "gold"
                  ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                  : lead.niveau === "silver"
                  ? "bg-gray-100 text-gray-700 border-gray-300"
                  : "bg-orange-100 text-orange-700 border-orange-300"
              }
            >
              {lead.niveau}
            </Badge>
          )}
          {lead.enriched_via && <Badge variant="outline">{lead.enriched_via}</Badge>}
          {lead.last_visited && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
              <Eye className="h-3 w-3" />
              {formatTimeAgo(lead.last_visited)}
            </span>
          )}
        </div>
      </div>

      {/* Status + action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-8 w-[150px] text-xs font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${s.color}`} />
                {s.label}
              </SelectItem>
            ))}
            <SelectItem value="archive">
              <span className="inline-block w-2 h-2 rounded-full mr-2 bg-gray-400" />
              Archive
            </SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} title={lead.phone}>
              <Button variant="outline" size="icon" className="h-10 w-10">
                <PhoneIcon className="h-5 w-5" />
              </Button>
            </a>
          )}
          {(lead.email || lead.dirigeant_email) && (
            <a href={`mailto:${lead.dirigeant_email || lead.email}`}>
              <Button variant="outline" size="icon" className="h-10 w-10" title="Email">
                <Mail className="h-5 w-5" />
              </Button>
            </a>
          )}
          {/* Quick Notes */}
          <QuickNotes
            domain={domain}
            initialNotes={lead.outreach_notes || ""}
            dirigeant={lead.dirigeant}
            onSaved={onUpdated}
          />
          {/* Google Calendar — Rappel/RDV */}
          <a
            href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Rappel " + (lead.nom_entreprise || domain))}&details=${encodeURIComponent((lead.dirigeant ? lead.dirigeant + "\n" : "") + (lead.phone || "") + "\n" + (lead.email || lead.dirigeant_email || ""))}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Planifier dans Google Calendar"
          >
            <Button variant="outline" className="h-10 px-3 gap-1.5 text-xs font-medium">
              <svg className="h-5 w-5" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <rect x="40" y="40" width="120" height="120" rx="12" fill="#fff" stroke="#4285f4" strokeWidth="8"/>
                <rect x="40" y="40" width="120" height="30" rx="12" fill="#4285f4"/>
                <circle cx="80" cy="100" r="6" fill="#ea4335"/>
                <circle cx="120" cy="100" r="6" fill="#34a853"/>
                <circle cx="80" cy="130" r="6" fill="#fbbc04"/>
                <circle cx="120" cy="130" r="6" fill="#4285f4"/>
                <rect x="72" y="24" width="8" height="24" rx="4" fill="#4285f4"/>
                <rect x="120" y="24" width="8" height="24" rx="4" fill="#4285f4"/>
              </svg>
              Agenda
            </Button>
          </a>
          {/* Google Maps */}
          <GoogleMapsDropdown
            domain={domain}
            nomEntreprise={lead.nom_entreprise}
            adresse={lead.api_adresse || lead.address}
            ville={lead.ville}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 text-red-600 hover:bg-red-50 hover:text-red-700"
            title="Degager (hors cible)"
            onClick={handleDismiss}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Stage transition modal — opens on every stage change */}
      <StageTransitionModal
        open={transitionOpen}
        targetStage={pendingStage || ""}
        domain={domain}
        dirigeant={lead.dirigeant}
        onConfirm={handleTransitionConfirm}
        onCancel={handleTransitionCancel}
      />
    </div>
  );
}
