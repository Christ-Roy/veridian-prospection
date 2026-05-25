"use client";

/**
 * Sous-modal "✨ Rédige avec IA" — déclenchée depuis la modale Compose mail.
 *
 * UX :
 *  - Radio objectif (4 choix) + radio ton (3 choix) — un seul clic suffit
 *    pour générer (defaults : intro + formel).
 *  - Bouton "Générer" → 3-8s loading → injection subject+body dans la
 *    modal compose parente → fermeture auto.
 *  - Erreur 412 (not_configured) : message explicite vers /settings/mail.
 *
 * Le commercial peut TOUJOURS éditer le résultat avant envoi côté modal
 * compose — l'IA n'est qu'un assistant.
 */
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface AiGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siren: string;
  onGenerated: (result: { subject: string; body_text: string }) => void;
}

type Objective = "intro" | "relance" | "demo" | "follow_rdv";
type Tone = "formel" | "friendly" | "expert";

const OBJECTIVES: { value: Objective; label: string; hint: string }[] = [
  { value: "intro", label: "Intro", hint: "Premier contact" },
  { value: "relance", label: "Relance", hint: "Pas de réponse" },
  { value: "demo", label: "Démo", hint: "Proposer une démo" },
  { value: "follow_rdv", label: "Suite RDV", hint: "Après échange" },
];

const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "formel", label: "Formel", hint: "Pro classique" },
  { value: "friendly", label: "Friendly", hint: "Décontracté" },
  { value: "expert", label: "Expert", hint: "Technique" },
];

export function AiGenerateDialog({
  open,
  onOpenChange,
  siren,
  onGenerated,
}: AiGenerateDialogProps) {
  const [objective, setObjective] = useState<Objective>("intro");
  const [tone, setTone] = useState<Tone>("formel");
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/mail/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siren, objective, tone }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        subject?: string;
        body_text?: string;
        body_html?: string;
        reason?: string;
        error?: string;
        hint?: string;
      };
      if (res.ok && data.subject && data.body_text) {
        toast.success("Mail généré");
        onGenerated({ subject: data.subject, body_text: data.body_text });
        return;
      }
      if (res.status === 412) {
        toast.error("IA non configurée", {
          description: data.hint ?? "Va dans Paramètres › Mail › onglet IA",
        });
        return;
      }
      if (res.status === 401) {
        toast.error("Clé API invalide", {
          description: "Reconfigure ta clé dans Paramètres › Mail › IA",
        });
        return;
      }
      toast.error(`Échec : ${data.reason ?? "unknown"}`, {
        description: data.error?.slice(0, 200),
      });
    } catch (err) {
      toast.error(`Erreur réseau : ${err instanceof Error ? err.message : String(err)}`);
    }
    setGenerating(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Rédige avec IA
          </DialogTitle>
          <DialogDescription>
            Génère un mail personnalisé selon le contexte du prospect
            (secteur, dette tech, historique). Tu pourras éditer avant envoi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Objectif</Label>
            <div className="grid grid-cols-2 gap-2">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setObjective(o.value)}
                  className={
                    "rounded-md border px-3 py-2 text-left text-sm transition " +
                    (objective === o.value
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-input hover:bg-accent")
                  }
                >
                  <div className="font-medium">{o.label}</div>
                  <div className="text-xs text-muted-foreground">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Ton</Label>
            <div className="grid grid-cols-3 gap-2">
              {TONES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTone(t.value)}
                  className={
                    "rounded-md border px-3 py-2 text-left text-sm transition " +
                    (tone === t.value
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-input hover:bg-accent")
                  }
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-muted-foreground">{t.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            <Link href="/settings/mail" className="underline">
              Configurer ma clé API IA
            </Link>{" "}
            (admin only) si pas encore fait.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Annuler
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="gap-2"
            data-testid="ai-generate-submit"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
