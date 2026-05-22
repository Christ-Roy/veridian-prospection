"use client";

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SansSiteData {
  total: number;
  categories: {
    rge: number;
    qualiopi: number;
    epv: number;
    bni: number;
    bio: number;
    nonIdentifieAvecTel: number;
  };
  qualiopiSpecialites: { specialite: string; count: number }[];
}

export interface SansSiteFilterState {
  rge: boolean;
  qualiopi: boolean;
  epv: boolean;
  bni: boolean;
  bio: boolean;
  nonIdentifieAvecTel: boolean;
  qualiopiSpecialite: string | null;
}

interface SansSiteSidebarProps {
  value: SansSiteFilterState;
  onChange: (next: SansSiteFilterState) => void;
}

const EMPTY_STATE: SansSiteFilterState = {
  rge: false,
  qualiopi: false,
  epv: false,
  bni: false,
  bio: false,
  nonIdentifieAvecTel: false,
  qualiopiSpecialite: null,
};

/**
 * Corps du filtre "sans site" — réutilisé tel quel par la sidebar
 * desktop (`SansSiteSidebar`) et par le volet accordéon mobile
 * (`MobileFilterDrawer`). Pas de wrapper latéral ici : ce composant
 * gère uniquement le fetch + la liste de catégories.
 */
export function SansSiteFilterBody({ value, onChange }: SansSiteSidebarProps) {
  const [data, setData] = useState<SansSiteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [qualiopiExpanded, setQualiopiExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sans-site-filters")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasAnyFilter = useMemo(
    () =>
      value.rge ||
      value.qualiopi ||
      value.epv ||
      value.bni ||
      value.bio ||
      value.nonIdentifieAvecTel ||
      !!value.qualiopiSpecialite,
    [value]
  );

  if (loading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full rounded" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

  function toggle(key: keyof SansSiteFilterState) {
    if (key === "qualiopi") {
      // Toggling off Qualiopi also drops any specialite sub-selection
      onChange({
        ...value,
        qualiopi: !value.qualiopi,
        qualiopiSpecialite: !value.qualiopi ? value.qualiopiSpecialite : null,
      });
      return;
    }
    if (key === "qualiopiSpecialite") return;
    onChange({ ...value, [key]: !value[key] } as SansSiteFilterState);
  }

  function selectSpecialite(spec: string) {
    if (value.qualiopiSpecialite === spec) {
      onChange({ ...value, qualiopiSpecialite: null });
    } else {
      // Auto-check Qualiopi parent so the UI stays consistent
      onChange({ ...value, qualiopi: true, qualiopiSpecialite: spec });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between pb-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {fmt(data.total)} sans site
        </span>
        {hasAnyFilter && (
          <button
            className="text-[11px] text-indigo-600 hover:underline min-h-[32px] px-1"
            onClick={() => onChange(EMPTY_STATE)}
          >
            Reset
          </button>
        )}
      </div>

      <ul className="space-y-0.5 text-sm">
        <SansSiteItem
          label="RGE"
          count={data.categories.rge}
          checked={value.rge}
          onToggle={() => toggle("rge")}
        />

        <li>
          <div className="flex items-center gap-1">
            <button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setQualiopiExpanded((v) => !v)}
              aria-label="toggle Qualiopi subtree"
            >
              {qualiopiExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <SansSiteItemBody
              label="Qualiopi"
              count={data.categories.qualiopi}
              checked={value.qualiopi}
              onToggle={() => toggle("qualiopi")}
            />
          </div>
          {qualiopiExpanded && data.qualiopiSpecialites.length > 0 && (
            <ul className="ml-5 mt-0.5 space-y-0.5 border-l pl-2 max-h-64 overflow-y-auto">
              {data.qualiopiSpecialites.map((s) => (
                <li key={s.specialite}>
                  <button
                    className={`w-full min-h-[32px] text-left text-xs py-1.5 px-1 rounded hover:bg-muted flex justify-between items-center ${
                      value.qualiopiSpecialite === s.specialite
                        ? "bg-muted font-medium"
                        : ""
                    }`}
                    onClick={() => selectSpecialite(s.specialite)}
                    title={s.specialite}
                  >
                    <span className="truncate pr-1">{s.specialite}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {fmt(s.count)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>

        <SansSiteItem
          label="EPV"
          count={data.categories.epv}
          checked={value.epv}
          onToggle={() => toggle("epv")}
        />
        <SansSiteItem
          label="BNI"
          count={data.categories.bni}
          checked={value.bni}
          onToggle={() => toggle("bni")}
        />
        <SansSiteItem
          label="Bio"
          count={data.categories.bio}
          checked={value.bio}
          onToggle={() => toggle("bio")}
        />
        <SansSiteItem
          label="Non identifié (avec tél)"
          count={data.categories.nonIdentifieAvecTel}
          checked={value.nonIdentifieAvecTel}
          onToggle={() => toggle("nonIdentifieAvecTel")}
        />
      </ul>
    </div>
  );
}

/**
 * Sidebar "sans site" — desktop uniquement (`hidden md:block`).
 * Sur mobile, ces filtres passent par le volet accordéon
 * `MobileFilterDrawer` qui réutilise `SansSiteFilterBody`.
 */
export function SansSiteSidebar({ value, onChange }: SansSiteSidebarProps) {
  return (
    <aside className="w-56 border-r bg-white dark:bg-gray-900 dark:border-gray-800 flex-shrink-0 overflow-y-auto hidden md:block">
      <div className="p-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Sans site
        </span>
      </div>
      <div className="px-2 pb-4">
        <SansSiteFilterBody value={value} onChange={onChange} />
      </div>
    </aside>
  );
}

function SansSiteItem({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center pl-4">
      <SansSiteItemBody
        label={label}
        count={count}
        checked={checked}
        onToggle={onToggle}
      />
    </li>
  );
}

function SansSiteItemBody({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
  return (
    <label className="flex min-h-[36px] items-center gap-2.5 py-1.5 px-1 rounded hover:bg-muted cursor-pointer flex-1">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{fmt(count)}</span>
    </label>
  );
}

export const EMPTY_SANS_SITE_STATE = EMPTY_STATE;
