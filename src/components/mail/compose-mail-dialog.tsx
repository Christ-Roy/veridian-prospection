"use client";

/**
 * Modale "Envoyer un mail" — déclenchée depuis la fiche lead.
 *
 * Flow :
 *  1. L'user choisit un template (ou compose libre) → preview rendue avec
 *     les vars prospect/sender.
 *  2. Edit possible du subject/body (le template n'est qu'un point de départ).
 *  3. Send → /api/mail/send → toast succès/erreur, fermeture si OK.
 *
 * Si /api/mail/config retourne passwordConfigured=false, on bloque le send
 * et on redirige vers /settings/mail.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Mail, Send, Sparkles, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { renderTemplate } from "@/lib/mail/templates";
import { AiGenerateDialog } from "@/components/mail/ai-generate-dialog";
import { PreviewMailDialog } from "@/components/mail/preview-mail-dialog";

interface ComposeMailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Email destinataire pré-rempli (depuis la fiche lead). */
  to: string;
  /** Variables pour le rendu liquid. */
  prospect: { name: string; entreprise: string };
  /** SIREN du prospect — tracé côté lead_emails pour la timeline. */
  siren: string | null;
}

const FREEFORM = "__freeform__";

interface TemplateOption {
  slug: string;
  label: string;
  isCustom?: boolean;
}

export function ComposeMailDialog({
  open,
  onOpenChange,
  to,
  prospect,
  siren,
}: ComposeMailDialogProps) {
  const [templateSlug, setTemplateSlug] = useState<string>(FREEFORM);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [senderName, setSenderName] = useState<string>("");
  const [aiOpen, setAiOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);

  // Charge la liste templates (customs + fallbacks) au mount de la modale.
  useEffect(() => {
    if (!open) return;
    fetch("/api/mail/templates")
      .then((r) => r.json())
      .then((data: { templates?: TemplateOption[] }) => {
        setTemplates(data.templates ?? []);
      })
      .catch(() => setTemplates([]));
  }, [open]);

  // Charge l'état config (passwordConfigured) au mount de la modale.
  useEffect(() => {
    if (!open) return;
    fetch("/api/mail/config")
      .then((r) => r.json())
      .then((data: { passwordConfigured?: boolean; fromName?: string | null; fromEmail?: string | null }) => {
        setConfigReady(data.passwordConfigured === true && !!data.fromEmail);
        setSenderName(data.fromName ?? "");
      })
      .catch(() => setConfigReady(false));
  }, [open]);

  // Reset à l'ouverture (évite de mélanger 2 prospects).
  useEffect(() => {
    if (open) {
      setTemplateSlug(FREEFORM);
      setSubject("");
      setBodyText("");
      setBodyHtml("");
    }
  }, [open, to]);

  // Quand le template change, on rend preview via /api/mail/render-preview
  // (qui résout customs + fallbacks côté serveur). Évite la duplication de
  // logique render entre client et serveur.
  async function handleTemplateChange(slug: string) {
    setTemplateSlug(slug);
    if (slug === FREEFORM) {
      setSubject("");
      setBodyText("");
      setBodyHtml("");
      return;
    }
    try {
      const res = await fetch("/api/mail/render-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateSlug: slug,
          vars: {
            prospect,
            sender: { name: senderName || "Moi", email: "" },
          },
          // Inclus pas la signature ici — elle sera appendée par le serveur
          // au moment de l'envoi (sinon double append si l'user édite).
          includeSignature: false,
        }),
      });
      if (!res.ok) {
        // Fallback : pas de pre-render, l'user devra taper son contenu.
        // L'erreur exacte sera visible si l'user clique sur "Aperçu".
        setSubject("");
        setBodyText("");
        setBodyHtml("");
        return;
      }
      const data = (await res.json()) as {
        subject: string;
        bodyText: string;
        bodyHtml: string;
      };
      setSubject(data.subject);
      setBodyText(data.bodyText);
      setBodyHtml(data.bodyHtml);
    } catch {
      setSubject("");
      setBodyText("");
      setBodyHtml("");
    }
  }
  // renderTemplate gardé importé pour les usages futurs (rendu côté client
  // sans aller-retour serveur). Pas appelé dans ce composant pour l'instant.
  void renderTemplate;

  async function handleSend() {
    if (!to) {
      toast.error("Destinataire manquant");
      return;
    }
    if (!subject || !bodyText) {
      toast.error("Sujet et corps requis");
      return;
    }
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        to,
        siren: siren ?? undefined,
        // On envoie systématiquement en compose libre (subject+body) parce
        // que l'user a pu éditer le rendu du template. Le slug n'est plus
        // qu'un libellé à tracer côté DB.
        subject,
        bodyText,
        bodyHtml: bodyHtml || `<p>${bodyText.replace(/\n/g, "<br>")}</p>`,
      };
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        errorMessage?: string;
        error?: string;
        status?: string;
        alreadyEnqueued?: boolean;
      };
      // 202 = queued (nouveau path async). 200 = sent (legacy gmail-via-hub).
      // Les deux sont des succès UX — le mail PART.
      if ((res.status === 202 || res.ok) && data.ok) {
        if (data.status === "queued") {
          toast.success(
            data.alreadyEnqueued
              ? "Mail déjà en file d'attente"
              : "Mail mis en file d'envoi",
            { description: "Envoi sous 1 min via la queue." },
          );
        } else {
          toast.success("Mail envoyé");
        }
        onOpenChange(false);
      } else if (res.status === 412) {
        toast.error("SMTP non configuré", {
          description: "Va dans Paramètres › Mail SMTP",
        });
      } else {
        toast.error(`Échec : ${data.reason ?? data.error ?? "unknown"}`, {
          description: data.errorMessage?.slice(0, 200),
        });
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSending(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Envoyer un mail
          </DialogTitle>
          <DialogDescription>
            À <strong>{to || "(aucun destinataire)"}</strong>
            {prospect.entreprise && ` — ${prospect.entreprise}`}
          </DialogDescription>
        </DialogHeader>

        {configReady === false && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            SMTP non configuré.{" "}
            <Link href="/settings/mail" className="underline font-medium">
              Aller dans Paramètres › Mail SMTP
            </Link>
            .
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="template-select">Template</Label>
              <Select value={templateSlug} onValueChange={handleTemplateChange}>
                <SelectTrigger id="template-select">
                  <SelectValue placeholder="Choisir un template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FREEFORM}>Compose libre</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAiOpen(true)}
              disabled={!siren}
              className="gap-2"
              data-testid="ai-generate-trigger"
              title={siren ? "Génère un mail IA personnalisé selon le contexte du prospect" : "Disponible uniquement depuis une fiche prospect"}
            >
              <Sparkles className="h-4 w-4" />
              Rédige avec IA
            </Button>
          </div>

          <div>
            <Label htmlFor="subject">Sujet</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Sujet du mail"
            />
          </div>

          <div>
            <Label htmlFor="body">Corps du message</Label>
            <Textarea
              id="body"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={10}
              placeholder="Bonjour..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Variables : {"{{ prospect.name }}"}, {"{{ prospect.entreprise }}"},
              {" {{ sender.name }}"}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            disabled={!subject || !bodyText}
            className="gap-2"
            data-testid="preview-trigger"
            title="Aperçu du rendu final avec signature appliquée"
          >
            <Eye className="h-4 w-4" /> Aperçu
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !to || !subject || configReady === false}
            className="gap-2"
            data-testid="send-mail-button"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>

      {siren && (
        <AiGenerateDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          siren={siren}
          onGenerated={({ subject: s, body_text }) => {
            setTemplateSlug(FREEFORM);
            setSubject(s);
            setBodyText(body_text);
            setBodyHtml("");
            setAiOpen(false);
          }}
        />
      )}

      <PreviewMailDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        templateSlug={templateSlug === FREEFORM ? null : templateSlug}
        subject={subject}
        bodyText={bodyText}
        bodyHtml={bodyHtml}
        prospect={prospect}
      />
    </Dialog>
  );
}
