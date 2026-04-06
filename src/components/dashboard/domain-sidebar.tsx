"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { DOMAINS } from "@/lib/domains";

// Icon mapping — matches the one from segment-page but expanded
const ICON_MAP: Record<string, { letter: string; color: string }> = {
  Globe: { letter: "All", color: "bg-indigo-600" },
  HardHat: { letter: "B", color: "bg-orange-600" },
  Heart: { letter: "S", color: "bg-red-500" },
  Scissors: { letter: "Be", color: "bg-pink-500" },
  Home: { letter: "Im", color: "bg-green-600" },
  UtensilsCrossed: { letter: "R", color: "bg-amber-600" },
  Car: { letter: "A", color: "bg-slate-600" },
  ShoppingBag: { letter: "C", color: "bg-violet-600" },
  Scale: { letter: "D", color: "bg-purple-700" },
  Ruler: { letter: "I", color: "bg-indigo-600" },
  Monitor: { letter: "IT", color: "bg-sky-600" },
  Briefcase: { letter: "Co", color: "bg-gray-600" },
  GraduationCap: { letter: "F", color: "bg-teal-600" },
  Sparkles: { letter: "N", color: "bg-cyan-600" },
  Wrench: { letter: "Re", color: "bg-yellow-700" },
  Truck: { letter: "T", color: "bg-emerald-700" },
  Dumbbell: { letter: "Sp", color: "bg-rose-600" },
  Factory: { letter: "In", color: "bg-zinc-600" },
  Shield: { letter: "As", color: "bg-blue-800" },
};

function DomainIcon({ iconName }: { iconName: string }) {
  const icon = ICON_MAP[iconName] || { letter: "?", color: "bg-gray-500" };
  return (
    <span className={`inline-flex items-center justify-center h-6 w-6 rounded text-[10px] font-bold text-white flex-shrink-0 ${icon.color}`}>
      {icon.letter}
    </span>
  );
}

interface DomainSidebarProps {
  selectedDomain: string;
  onSelectDomain: (domainId: string) => void;
  counts: Record<string, number> | null;
  loading: boolean;
}

export function DomainSidebar({ selectedDomain, onSelectDomain, counts, loading }: DomainSidebarProps) {
  return (
    <aside className="w-56 border-r bg-white flex-shrink-0 overflow-y-auto">
      <div className="p-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Secteurs
        </span>
      </div>
      <nav className="px-2 pb-3 space-y-0.5">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)
        ) : (
          DOMAINS.map(domain => {
            const isActive = selectedDomain === domain.id;
            const count = counts?.[domain.id] ?? 0;
            return (
              <button
                key={domain.id}
                onClick={() => onSelectDomain(domain.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <DomainIcon iconName={domain.icon} />
                <span className="truncate flex-1">{domain.label}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground flex-shrink-0">
                  {count.toLocaleString()}
                </span>
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}
