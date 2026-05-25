"use client";

/**
 * Bandeau d'aide affiché sous le champ Email/Username quand un preset
 * fournisseur est détecté ET qu'il exige un App Password (Gmail/MS/
 * Yahoo/iCloud depuis 2022).
 *
 * Pour OVH/Free : pas de bandeau, le password de boîte direct marche.
 * Pour domaine inconnu : pas de bandeau non plus, mais auto-fill géré
 * en amont par le parent.
 *
 * Le bouton CTA ouvre la page App Password du fournisseur dans un
 * nouvel onglet (target="_blank" rel="noopener noreferrer"), et un
 * accordéon déroule le guide step-by-step.
 */
import { useState } from "react";
import { ExternalLink, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MailProviderPreset } from "@/lib/mail/provider-presets";

interface MailProviderHintProps {
  provider: MailProviderPreset | null;
}

export function MailProviderHint({ provider }: MailProviderHintProps) {
  const [showGuide, setShowGuide] = useState(false);

  if (!provider || !provider.requiresAppPassword) return null;

  return (
    <div
      data-testid="mail-provider-hint"
      data-provider={provider.id}
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="font-medium">
            {provider.label} exige un App Password
          </p>
          <p className="text-xs text-amber-800">
            Depuis 2022, {provider.label} bloque la connexion IMAP/SMTP avec
            ton mot de passe principal. Il faut générer un mot de passe
            applicatif dédié à Veridian (16 caractères) et le coller ici.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {provider.appPasswordUrl && (
              <Button
                asChild
                size="sm"
                className="gap-1"
                data-testid="mail-provider-app-password-cta"
              >
                <a
                  href={provider.appPasswordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Créer un App Password
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
            {provider.appPasswordGuide && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setShowGuide((v) => !v)}
                data-testid="mail-provider-toggle-guide"
                aria-expanded={showGuide}
              >
                Guide étape par étape
                {showGuide ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>

          {showGuide && provider.appPasswordGuide && (
            <div
              data-testid="mail-provider-guide-steps"
              className="mt-2 rounded-md border border-amber-200 bg-white/60 px-3 py-2"
            >
              <p className="font-medium text-xs mb-1.5">
                {provider.appPasswordGuide.title}
              </p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-amber-900">
                {provider.appPasswordGuide.steps.map((step, idx) => (
                  <li key={idx}>{step.text}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
