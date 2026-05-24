"use client";

/**
 * Hook client qui fournit les stages pipeline du workspace courant.
 *
 * Lecture côté API `/api/pipeline-stages` (résout le workspace actif via
 * cookie + UserContext serveur, pas de fuite cross-tenant). Cache mémoire
 * 60s pour éviter de retaper la même requête à chaque mount.
 *
 * Fallback : si l'API échoue (offline, 5xx) ou renvoie une liste vide, on
 * retombe sur la liste hardcodée historique (PIPELINE_STAGES de types.ts)
 * pour ne PAS casser le kanban des clients existants pendant un dropout
 * d'API. C'est exactement le filet "1 jour" prévu par le ticket §"Risques".
 */

import { useEffect, useState, useCallback } from "react";
import { PIPELINE_STAGES as LEGACY_STAGES, getPipelineStage as legacyGet } from "@/lib/types";

export type PipelineStageView = {
  id: string;           // = slug, alias pour compat avec l'ancien shape
  slug: string;
  label: string;
  position: number;
  color: string;        // token Tailwind (ex: "bg-emerald-500"), jamais null
  bgLight: string;      // dérivé : bg-emerald-50 etc.
  textColor: string;    // dérivé : text-emerald-700 etc.
  isTerminal: boolean;
  isHidden: boolean;
  autoArchiveDays: number | null;  // legacy — 7j sur les stages froids, sinon null
};

/**
 * Mapping legacy → autoArchiveDays. Seuls les 3 premiers stades canoniques
 * (fiche_ouverte, repondeur, a_rappeler) ont un seuil d'auto-archivage à
 * 7 jours. Pour les stages custom, NULL → pas d'archivage auto (le code
 * pipeline-board.tsx gère le NULL en n'affichant pas d'urgence).
 */
const LEGACY_AUTO_ARCHIVE: Record<string, number | null> = {
  fiche_ouverte: 7,
  repondeur: 7,
  a_rappeler: 7,
};

function deriveLightColor(color: string | null): string {
  if (!color) return "bg-slate-50";
  // "bg-emerald-500" → "bg-emerald-50"
  const m = color.match(/^bg-([a-z]+)-\d+$/);
  return m ? `bg-${m[1]}-50` : "bg-slate-50";
}

function deriveTextColor(color: string | null): string {
  if (!color) return "text-slate-700";
  const m = color.match(/^bg-([a-z]+)-\d+$/);
  return m ? `text-${m[1]}-700` : "text-slate-700";
}

/**
 * Convertit la liste hardcodée legacy en PipelineStageView. Sert de
 * fallback total si l'API échoue ET d'écho strict du comportement
 * historique côté UI (avant la feature stages custom).
 */
function legacyToView(): PipelineStageView[] {
  return LEGACY_STAGES.map((s, i) => ({
    id: s.id,
    slug: s.id,
    label: s.label,
    position: i,
    color: s.color,
    bgLight: s.bgLight,
    textColor: s.textColor,
    isTerminal: false,
    isHidden: false,
    autoArchiveDays: s.autoArchiveDays,
  }));
}

// Cache mémoire module-level. Court (60s) — assez pour éviter le N+1 entre
// composants montés simultanément (kanban + lead-sheet), assez court pour
// que l'edit d'un stage via /settings/pipeline soit visible vite.
const CACHE_TTL_MS = 60_000;
let cache: { stages: PipelineStageView[]; expiresAt: number } | null = null;
let inflight: Promise<PipelineStageView[]> | null = null;

async function fetchStages(): Promise<PipelineStageView[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.stages;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/pipeline-stages", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.stages) ? data.stages : [];
      if (list.length === 0) {
        // Workspace sans stages (cas pathologique : workspace créé avant la
        // migration sans seed manuel). Fallback legacy pour ne pas planter.
        return legacyToView();
      }
      const stages: PipelineStageView[] = list.map((s: {
        id?: string;
        slug: string;
        label: string;
        position?: number;
        color: string | null;
        isTerminal?: boolean;
        isHidden?: boolean;
      }, i: number) => ({
        id: s.slug,
        slug: s.slug,
        label: s.label,
        position: typeof s.position === "number" ? s.position : i,
        color: s.color || "bg-slate-500",
        bgLight: deriveLightColor(s.color),
        textColor: deriveTextColor(s.color),
        isTerminal: !!s.isTerminal,
        isHidden: !!s.isHidden,
        autoArchiveDays: LEGACY_AUTO_ARCHIVE[s.slug] ?? null,
      }));
      cache = { stages, expiresAt: Date.now() + CACHE_TTL_MS };
      return stages;
    } catch {
      return legacyToView();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Invalide le cache (à appeler après un edit/create/delete dans /settings/pipeline).
 */
export function invalidatePipelineStagesCache() {
  cache = null;
}

export function useWorkspacePipelineStages(): {
  stages: PipelineStageView[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  // SSR-safe : initialise avec la liste legacy (= 8 stages canoniques)
  // → premier render serveur correct + zéro layout shift au montage.
  // Le useEffect remplace immédiatement par les stages du workspace.
  const [stages, setStages] = useState<PipelineStageView[]>(() => legacyToView());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    invalidatePipelineStagesCache();
    setLoading(true);
    const next = await fetchStages();
    setStages(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchStages().then((next) => {
      if (alive) {
        setStages(next);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  return { stages, loading, refresh };
}

/**
 * Lookup synchrone par slug. Retourne un stage view trouvé OU un fallback
 * dérivé du slug (pour les stages disparus du workspace mais qui
 * existent encore sur des leads anciens). Garantit que l'UI ne crashe
 * jamais sur un slug inconnu.
 */
export function findStageOrFallback(
  stages: PipelineStageView[],
  slug: string,
): PipelineStageView {
  const found = stages.find((s) => s.slug === slug);
  if (found) return found;
  // Fallback synthétique : essaie d'abord la lib legacy (cas slug
  // canonique d'un workspace dont les stages custom auraient été
  // soft-deleted), sinon un blob neutre.
  const legacy = legacyGet(slug);
  if (legacy.id === slug) {
    return {
      id: slug,
      slug,
      label: legacy.label,
      position: 999,
      color: legacy.color,
      bgLight: legacy.bgLight,
      textColor: legacy.textColor,
      isTerminal: false,
      isHidden: false,
      autoArchiveDays: legacy.autoArchiveDays,
    };
  }
  return {
    id: slug,
    slug,
    label: slug,
    position: 999,
    color: "bg-slate-500",
    bgLight: "bg-slate-50",
    textColor: "text-slate-700",
    isTerminal: false,
    isHidden: false,
    autoArchiveDays: null,
  };
}
