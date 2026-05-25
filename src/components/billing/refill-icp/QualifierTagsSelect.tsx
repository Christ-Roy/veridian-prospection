"use client";

/**
 * Sélecteur qualifiers ICP — flags business (RGE, Qualiopi, Bio, …).
 *
 * Gated business : si `gated=true`, le composant est désactivé avec un
 * tooltip "Réservé au plan Business". L'API filtre n'accepte pas non plus
 * un user freemium qui forge l'appel — cf rate-limit + check côté start.
 *
 * State controlled `value = QualifierKey[]`.
 */
import { Lock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { QUALIFIER_KEYS, type QualifierKey } from "@/lib/refill-icp/filters";

type QualifierTagsSelectProps = {
  value: QualifierKey[];
  onChange: (next: QualifierKey[]) => void;
  gated?: boolean;
  disabled?: boolean;
};

const QUALIFIER_LABELS: Record<QualifierKey, string> = {
  has_website: "A un site web",
  no_website: "Sans site web",
  rge: "Certifié RGE",
  qualiopi: "Certifié Qualiopi",
  bio: "Certifié Bio",
  epv: "EPV (Entreprise du Patrimoine Vivant)",
  ess: "ESS",
  marches_publics: "Marchés publics",
  with_phone: "Téléphone disponible",
  with_email: "Email disponible",
  auto_entrepreneur: "Auto-entrepreneur",
};

export function QualifierTagsSelect({
  value,
  onChange,
  gated,
  disabled,
}: QualifierTagsSelectProps) {
  const effDisabled = disabled || gated;

  function toggle(k: QualifierKey) {
    if (effDisabled) return;
    if (value.includes(k)) {
      onChange(value.filter((x) => x !== k));
    } else {
      onChange([...value, k]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Qualifiers ICP</Label>
        {gated && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
            <Lock className="h-3 w-3" />
            Plan Business
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {QUALIFIER_KEYS.map((k) => {
          const active = value.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              disabled={effDisabled}
              aria-pressed={active}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (effDisabled
                  ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
                  : active
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300")
              }
            >
              {QUALIFIER_LABELS[k]}
            </button>
          );
        })}
      </div>
      {gated && (
        <p className="text-xs text-neutral-500">
          Passez au plan Business pour cibler par certifications et signaux
          business avancés.
        </p>
      )}
    </div>
  );
}
