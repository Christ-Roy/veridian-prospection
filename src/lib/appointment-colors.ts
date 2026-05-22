/**
 * appointment-colors — palette partagée des rendez-vous.
 *
 * Source de vérité unique pour la couleur d'un RDV selon son `sourceStage`
 * de pipeline. Consommée par le calendrier (`appointment-calendar.tsx`) et
 * la liste latérale (`upcoming-appointments.tsx`) pour garantir la cohérence
 * visuelle entre les deux vues.
 *
 * Les RDV ne proviennent que de deux stages porteurs d'échéance
 * (`a_rappeler`, `site_demo`) — tout le reste retombe sur `default`.
 */

export type AppointmentStageKey = "a_rappeler" | "site_demo" | "default";

type AppointmentPalette = {
  /** Variable CSS de fond de l'événement (définie dans globals.css). */
  fcVar: string;
  /** Variable CSS de la bordure / accent de l'événement. */
  fcBorderVar: string;
  /** Classes Tailwind du conteneur (liste latérale). */
  surface: string;
  /** Classes Tailwind de l'icône de stage. */
  icon: string;
  /** Classe Tailwind de la pastille de couleur. */
  dot: string;
};

const PALETTES: Record<AppointmentStageKey, AppointmentPalette> = {
  a_rappeler: {
    fcVar: "var(--fc-appt-rappel-bg)",
    fcBorderVar: "var(--fc-appt-rappel-border)",
    surface:
      "border-amber-200/70 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40",
    icon: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  site_demo: {
    fcVar: "var(--fc-appt-demo-bg)",
    fcBorderVar: "var(--fc-appt-demo-border)",
    surface:
      "border-violet-200/70 bg-violet-50 dark:border-violet-900/60 dark:bg-violet-950/40",
    icon: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  default: {
    fcVar: "var(--fc-appt-default-bg)",
    fcBorderVar: "var(--fc-appt-default-border)",
    surface:
      "border-sky-200/70 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/40",
    icon: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500",
  },
};

/** Normalise un `sourceStage` arbitraire vers une clé de palette connue. */
export function resolveStageKey(stage: string | null | undefined): AppointmentStageKey {
  if (stage === "a_rappeler" || stage === "site_demo") return stage;
  return "default";
}

/** Palette complète pour un `sourceStage` donné. */
export function appointmentPalette(stage: string | null | undefined): AppointmentPalette {
  return PALETTES[resolveStageKey(stage)];
}
