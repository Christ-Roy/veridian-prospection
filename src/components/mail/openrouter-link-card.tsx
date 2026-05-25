"use client";

/**
 * Card "OpenRouter" dans /settings/mail onglet "IA".
 *
 * 3 états :
 *   - non connecté + Veridian fallback dispo
 *     → "Génération offerte par Veridian (gratuit). Connecter votre compte
 *        pour usage illimité"
 *   - non connecté + pas de Veridian fallback
 *     → "Connecter un compte OpenRouter pour activer la génération IA"
 *   - connecté
 *     → "Compte connecté (email)" + bouton Déconnecter
 *
 * Le bouton "Connecter" déclenche un full redirect (GET) vers la route
 * connect — pas de fetch async. C'est le pattern OAuth standard.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Link2, Unlink, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Status {
  connected: boolean;
  openrouterEmail: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
  veridianFallbackAvailable: boolean;
}

const DEFAULT: Status = {
  connected: false,
  openrouterEmail: null,
  connectedAt: null,
  lastUsedAt: null,
  veridianFallbackAvailable: false,
};

export function OpenRouterLinkCard() {
  const [status, setStatus] = useState<Status>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/openrouter/status")
      .then((r) => r.json())
      .then((data: Status) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Erreur de chargement du statut OpenRouter");
        setLoading(false);
      });

    // Toast en cas de retour OAuth (?ai=connected ou ?ai_error=...)
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("ai") === "connected") {
        toast.success("Compte OpenRouter connecté");
        // nettoie l'URL
        window.history.replaceState({}, "", window.location.pathname);
      } else if (sp.get("ai_error")) {
        toast.error(`Connexion OpenRouter échouée : ${sp.get("ai_error")}`);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);

  async function handleDisconnect() {
    if (!confirm("Déconnecter le compte OpenRouter ? La génération IA retombera sur la clé Veridian (gratuite) ou la config tenant si elle existe.")) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/openrouter/disconnect", { method: "DELETE" });
      if (res.ok) {
        toast.success("Compte OpenRouter déconnecté");
        setStatus({ ...DEFAULT, veridianFallbackAvailable: status.veridianFallbackAvailable });
      } else {
        toast.error("Erreur de déconnexion");
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setDisconnecting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <h3 className="font-medium">OpenRouter — Génération IA</h3>
      </div>

      {status.connected ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Compte connecté
              {status.openrouterEmail ? ` — ${status.openrouterEmail}` : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Vos générations IA débitent votre crédit OpenRouter (usage illimité
            selon votre dépôt). Connecté{" "}
            {status.connectedAt
              ? new Date(status.connectedAt).toLocaleDateString()
              : ""}
            .
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="gap-2"
          >
            {disconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
            Déconnecter
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {status.veridianFallbackAvailable && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
              <strong>Génération IA offerte par Veridian</strong> — utilisez l&apos;IA
              gratuitement (modèle Llama 3.3 70B free, plafonné à ~50 générations/jour
              partagées). Connectez votre compte OpenRouter pour un usage illimité
              sur votre crédit.
            </div>
          )}
          <Button
            asChild
            variant={status.veridianFallbackAvailable ? "outline" : "default"}
            size="sm"
            className="gap-2"
          >
            <a href="/api/integrations/openrouter/connect">
              <Link2 className="h-4 w-4" />
              Connecter mon compte OpenRouter
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
