"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Building2, Shield, Search, X, History, Smartphone } from "lucide-react";

interface FilterBarProps {
  onOpenFilter: (filter: "geo" | "taille" | "qualite") => void;
  activeFilters?: { geo: number; taille: number; qualite: number };
  onSearch?: (term: string) => void;
  searchValue?: string;
  onHistorique?: () => void;
  onClearHistorique?: () => void;
  isHistoriqueActive?: boolean;
  mobileOnly?: boolean;
  onToggleMobile?: () => void;
}

export function FilterBar({ onOpenFilter, activeFilters, onSearch, searchValue = "", onHistorique, onClearHistorique, isHistoriqueActive, mobileOnly, onToggleMobile }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(searchValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit() {
    onSearch?.(value.trim());
    if (!value.trim()) setOpen(false);
  }

  function clear() {
    setValue("");
    onSearch?.("");
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
      {/* Search */}
      {open ? (
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") clear(); }}
            placeholder="Domaine, entreprise, tel..."
            className="h-8 w-52 text-xs"
          />
          {value && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={clear}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ) : (
        <Button
          size="sm"
          variant={searchValue ? "default" : "outline"}
          className="h-8 gap-1.5 text-xs"
          onClick={() => setOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          {searchValue || "Rechercher"}
        </Button>
      )}

      {/* Mobile only toggle */}
      <Button
        size="sm"
        variant={mobileOnly ? "default" : "outline"}
        className="h-8 gap-1.5 text-xs"
        onClick={onToggleMobile}
      >
        <Smartphone className="h-3.5 w-3.5" />
        Mobile
      </Button>

      <Button
        size="sm"
        variant={activeFilters?.geo ? "default" : "outline"}
        className="h-8 gap-1.5 text-xs"
        onClick={() => onOpenFilter("geo")}
      >
        <MapPin className="h-3.5 w-3.5" />
        Geographie
        {activeFilters?.geo ? <span className="ml-0.5 h-4 w-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">*</span> : null}
      </Button>
      <Button
        size="sm"
        variant={activeFilters?.taille ? "default" : "outline"}
        className="h-8 gap-1.5 text-xs"
        onClick={() => onOpenFilter("taille")}
      >
        <Building2 className="h-3.5 w-3.5" />
        Taille
        {activeFilters?.taille ? <span className="ml-0.5 h-4 w-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">*</span> : null}
      </Button>
      <Button
        size="sm"
        variant={activeFilters?.qualite ? "default" : "outline"}
        className="h-8 gap-1.5 text-xs"
        onClick={() => onOpenFilter("qualite")}
      >
        <Shield className="h-3.5 w-3.5" />
        Qualite
        {activeFilters?.qualite ? <span className="ml-0.5 h-4 w-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">*</span> : null}
      </Button>

      {/* Historique */}
      <Button
        size="sm"
        variant={isHistoriqueActive ? "default" : "outline"}
        className="h-8 gap-1.5 text-xs"
        onClick={() => isHistoriqueActive ? onClearHistorique?.() : onHistorique?.()}
      >
        <History className="h-3.5 w-3.5" />
        Historique
      </Button>
    </div>
  );
}
