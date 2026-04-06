"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

const STORAGE_KEY = "prospect-sector-filter";

interface SectorTree {
  [secteur: string]: {
    total: number;
    domaines: Record<string, number>;
  };
}

interface SectorSidebarProps {
  selectedSecteurs: string[];
  selectedDomaines: string[];
  onSelect: (secteurs: string[], domaines: string[]) => void;
}

export function SectorSidebar({ selectedSecteurs, selectedDomaines, onSelect }: SectorSidebarProps) {
  const [tree, setTree] = useState<SectorTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/sectors")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTree(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ secteurs: selectedSecteurs, domaines: selectedDomaines }));
  }, [selectedSecteurs, selectedDomaines]);

  function toggleSecteur(s: string) {
    const isSelected = selectedSecteurs.includes(s);
    if (isSelected) {
      // Uncheck secteur + all its domaines
      const domainesOfSecteur = Object.keys(tree?.[s]?.domaines || {});
      onSelect(
        selectedSecteurs.filter(x => x !== s),
        selectedDomaines.filter(x => !domainesOfSecteur.includes(x))
      );
    } else {
      onSelect([...selectedSecteurs, s], selectedDomaines);
    }
  }

  function toggleDomaine(secteur: string, domaine: string) {
    const isSelected = selectedDomaines.includes(domaine);
    if (isSelected) {
      onSelect(selectedSecteurs, selectedDomaines.filter(x => x !== domaine));
    } else {
      onSelect(selectedSecteurs, [...selectedDomaines, domaine]);
    }
  }

  function toggleExpand(s: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const hasAnyFilter = selectedSecteurs.length > 0 || selectedDomaines.length > 0;

  if (loading) {
    return (
      <aside className="w-56 border-r bg-white flex-shrink-0 overflow-y-auto hidden md:block">
        <div className="p-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Secteurs</span>
        </div>
        <div className="px-2 space-y-1">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)}
        </div>
      </aside>
    );
  }

  if (!tree) return null;

  const sortedSecteurs = Object.entries(tree).sort((a, b) => b[1].total - a[1].total);

  return (
    <aside className="w-56 border-r bg-white flex-shrink-0 overflow-y-auto hidden md:block">
      <div className="p-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Secteurs</span>
        {hasAnyFilter && (
          <button
            className="text-[10px] text-indigo-600 hover:underline"
            onClick={() => onSelect([], [])}
          >
            Reset
          </button>
        )}
      </div>
      <nav className="px-1 pb-3 space-y-0.5 text-xs">
        {sortedSecteurs.map(([secteur, data]) => {
          const isExpanded = expanded.has(secteur);
          const isSecteurChecked = selectedSecteurs.includes(secteur);
          const domainesList = Object.entries(data.domaines).sort((a, b) => b[1] - a[1]);
          return (
            <div key={secteur}>
              <div className="flex items-center gap-1 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
                <Checkbox
                  checked={isSecteurChecked}
                  onCheckedChange={() => toggleSecteur(secteur)}
                  className="h-3 w-3"
                />
                <button
                  className="flex-1 flex items-center gap-1 text-left truncate"
                  onClick={() => toggleExpand(secteur)}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <span className="truncate font-medium">{secteur}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{data.total.toLocaleString()}</span>
                </button>
              </div>
              {isExpanded && (
                <div className="ml-5 space-y-0.5">
                  {domainesList.map(([domaine, count]) => (
                    <label
                      key={domaine}
                      className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-muted/30 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedDomaines.includes(domaine)}
                        onCheckedChange={() => toggleDomaine(secteur, domaine)}
                        className="h-3 w-3"
                      />
                      <span className="truncate">{domaine}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{count.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
