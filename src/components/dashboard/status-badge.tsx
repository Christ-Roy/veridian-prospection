import { getStatusInfo } from "@/lib/types";

interface StatusBadgeProps {
  status: string;
  /** Number of fiches ouvertes today — drives animation speed */
  ficheOuverteCount?: number;
}

export function StatusBadge({ status, ficheOuverteCount = 0 }: StatusBadgeProps) {
  const info = getStatusInfo(status);
  const isActive = status === "fiche_ouverte" && ficheOuverteCount > 0;

  if (isActive) {
    // Animation speed: more fiches = faster (3s base → 0.5s at 50+)
    const duration = Math.max(0.5, 3 - (ficheOuverteCount / 50) * 2.5);
    return (
      <span
        className="badge-fiche-ouverte inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-100 text-indigo-700"
        style={{ "--badge-speed": `${duration}s` } as React.CSSProperties}
      >
        {info.label}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${info.color}`}>
      {info.label}
    </span>
  );
}
