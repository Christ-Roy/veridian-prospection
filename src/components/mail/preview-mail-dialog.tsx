"use client";

/**
 * Modale d'aperçu mail avant envoi.
 *
 * Cf ticket follow-ups §I. Affiche le rendu final du mail (subject +
 * body HTML) avec les variables remplies + signature appliquée. Le
 * body est rendu dans une iframe sandboxée pour éviter les fuites
 * CSS / les scripts inline.
 *
 * Reçoit { subject, bodyText, bodyHtml, vars } + templateSlug optionnel.
 * Appelle POST /api/mail/render-preview pour obtenir le rendu serveur
 * (cohérent avec ce que l'envoi réel produira).
 */
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Eye, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PreviewMailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateSlug: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  prospect: { name: string; entreprise: string };
}

interface PreviewResult {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  unresolvedVars: string[];
}

export function PreviewMailDialog({
  open,
  onOpenChange,
  templateSlug,
  subject,
  bodyText,
  bodyHtml,
  prospect,
}: PreviewMailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      return;
    }
    setLoading(true);
    fetch("/api/mail/render-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateSlug,
        subject,
        bodyText,
        bodyHtml,
        vars: { prospect },
        includeSignature: true,
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<PreviewResult>;
      })
      .then((data) => setPreview(data))
      .catch((err) => {
        toast.error(`Aperçu indisponible : ${err.message}`);
        setPreview(null);
      })
      .finally(() => setLoading(false));
  }, [open, templateSlug, subject, bodyText, bodyHtml, prospect]);

  // Injecte le HTML dans l'iframe sandboxée à chaque update.
  useEffect(() => {
    if (!preview || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><style>` +
        `body{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;padding:1rem;margin:0}` +
        `p{margin:0 0 0.8em 0}a{color:#0066cc}` +
        `.veridian-mail-signature{margin-top:1.5em;padding-top:0.8em;border-top:1px solid #e5e5e5;color:#666;font-size:13px}` +
        `</style></head><body>${preview.bodyHtml}</body></html>`,
    );
    doc.close();
  }, [preview]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Aperçu du mail
          </DialogTitle>
          <DialogDescription>
            Rendu final avec variables remplies + signature appliquée.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Rendu en cours…
          </div>
        ) : preview ? (
          <div className="space-y-3" data-testid="preview-content">
            {preview.unresolvedVars.length > 0 && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2"
                data-testid="preview-unresolved-warning"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <strong>Variables non remplies :</strong>{" "}
                  <code className="text-xs">
                    {preview.unresolvedVars.join(", ")}
                  </code>
                  <p className="text-xs mt-1">
                    Vérifie le template — ces variables apparaîtront brutes
                    dans le mail envoyé.
                  </p>
                </div>
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground mb-1">Sujet</div>
              <div
                className="font-medium border rounded-md px-3 py-2 bg-muted/30"
                data-testid="preview-subject"
              >
                {preview.subject}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Corps</div>
              <iframe
                ref={iframeRef}
                sandbox="allow-same-origin"
                className="w-full h-[18rem] border rounded-md bg-background"
                title="Aperçu du mail"
                data-testid="preview-iframe"
              />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground p-4 text-center">
            Aperçu indisponible.
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="preview-close"
          >
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
