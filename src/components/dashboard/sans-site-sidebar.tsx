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

export function SansSiteSidebar({ value, onChange }: SansSiteSidebarProps) {
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
      <aside className="w-56 border-r bg-white flex-shrink-0 overflow-y-auto hidden md:block">
        <div className="p-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Sans site
          </span>
        </div>
        <div className="px-2 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full rounded" />
          ))}
        </div>
      </aside>
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
    <aside className="w-56 border-r bg-white flex-shrink-0 overflow-y-auto hidden md:block">
      <div className="p-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Sans site · {fmt(data.total)}
        </span>
        {hasAnyFilter && (
          <button
            className="text-[10px] text-muted-foreground underline hover:text-foreground"
            onClick={() => onChange(EMPTY_STATE)}
          >
            reset
          </button>
        )}
      </div>

      <ul className="px-2 pb-4 space-y-0.5 text-sm">
        <SansSiteItem
          label="RGE"
          count={data.categories.rge}
          checked={value.rge}
          onToggle={() => toggle("rge")}
        />

        <li>
          <div className="flex items-center gap-1">
            <button
              className="p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setQualiopiExpanded((v) => !v)}
              aria-label="toggle Qualiopi subtree"
            >
              {qualiopiExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
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
                    className={`w-full text-left text-xs py-0.5 px-1 rounded hover:bg-muted flex justify-between items-center ${
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
    <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted cursor-pointer flex-1">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{fmt(count)}</span>
    </label>
  );
}

export const EMPTY_SANS_SITE_STATE = EMPTY_STATE;
