"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SlidersHorizontal, Search, X, Tag, MapPin, Building2, Shield,
  Smartphone, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectorFilterBody } from "./sector-sidebar";
import { SansSiteFilterBody, type SansSiteFilterState } from "./sans-site-sidebar";

/**
 * Volet de filtres mobile — `< md` uniquement.
 *
 * Sur desktop, les filtres vivent dans la `FilterBar` (boutons) + les
 * sidebars latérales (Secteur / Sans-site) + les `Sheet` Géo/Taille/Qualité.
 * Sur mobile la `FilterBar` débordait en scroll horizontal et les sidebars
 * étaient `hidden md:block` → injoignables. Ce drawer rassemble TOUS les
 * filtres dans des volets accordéon repliés par défaut.
 *
 * Il NE réécrit aucune logique de filtrage : il câble les états remontés
 * de `ProspectPage` aux composants de filtre existants (corps `SectorFilterBody`
 * / `SansSiteFilterBody`) et déclenche les `Sheet` Géo/Taille/Qualité déjà
 * rendus par la page.
 */
interface MobileFilterDrawerProps {
  // Recherche
  searchValue: string;
  onSearch: (term: string) => void;

  // Secteur (mode "with"/"all") — réutilise SectorFilterBody
  siteMode: "all" | "with" | "without";
  selectedSecteurs: string[];
  selectedDomaines: string[];
  onSelectSecteurs: (secteurs: string[], domaines: string[]) => void;

  // Sans-site (mode "without") — réutilise SansSiteFilterBody
  sansSiteFilter: SansSiteFilterState;
  onChangeSansSite: (next: SansSiteFilterState) => void;

  // Sheets Géo / Taille / Qualité (déjà rendus par ProspectPage)
  onOpenGeo: () => void;
  onOpenSize: () => void;
  onOpenQuality: () => void;
  activeFilters: { geo: number; taille: number; qualite: number };

  // Toggles divers de l'ex-FilterBar
  mobileOnly: boolean;
  onToggleMobile: () => void;
  isHistoriqueActive: boolean;
  onHistorique: () => void;
  onClearHistorique: () => void;
}

export function MobileFilterDrawer({
  searchValue,
  onSearch,
  siteMode,
  selectedSecteurs,
  selectedDomaines,
  onSelectSecteurs,
  sansSiteFilter,
  onChangeSansSite,
  onOpenGeo,
  onOpenSize,
  onOpenQuality,
  activeFilters,
  mobileOnly,
  onToggleMobile,
  isHistoriqueActive,
  onHistorique,
  onClearHistorique,
}: MobileFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(searchValue);
  const searchRef = useRef<HTMLInputElement>(null);

  // Resynchronise le champ local quand la recherche change ailleurs
  // (reset depuis un autre point d'entrée).
  useEffect(() => {
    setSearch(searchValue);
  }, [searchValue]);

  function submitSearch() {
    onSearch(search.trim());
  }

  function clearSearch() {
    setSearch("");
    onSearch("");
  }

  // Nombre de groupes de filtres actifs — badge sur le bouton déclencheur.
  const sectorActive = selectedSecteurs.length > 0 || selectedDomaines.length > 0;
  const sansSiteActive =
    sansSiteFilter.rge || sansSiteFilter.qualiopi || sansSiteFilter.epv ||
    sansSiteFilter.bni || sansSiteFilter.bio || sansSiteFilter.nonIdentifieAvecTel ||
    !!sansSiteFilter.qualiopiSpecialite;
  const activeCount =
    (searchValue ? 1 : 0) +
    (siteMode === "without" ? (sansSiteActive ? 1 : 0) : (sectorActive ? 1 : 0)) +
    activeFilters.geo + activeFilters.taille + activeFilters.qualite +
    (mobileOnly ? 1 : 0) +
    (isHistoriqueActive ? 1 : 0);

  // Bouton de section qui ouvre un Sheet existant (Géo/Taille/Qualité).
  // Fermer le drawer avant d'ouvrir le Sheet évite la superposition de
  // deux overlays et le piège de focus Radix.
  function openSheet(fn: () => void) {
    setOpen(false);
    // Laisse l'animation de fermeture du drawer démarrer avant le Sheet.
    setTimeout(fn, 120);
  }

  return (
    <>
      {/* Déclencheur — remplace la FilterBar débordante en mobile. */}
      <Button
        variant={activeCount > 0 ? "default" : "outline"}
        size="sm"
        className="h-9 gap-1.5 text-xs md:hidden"
        onClick={() => setOpen(true)}
        data-testid="mobile-filter-trigger"
        aria-label="Ouvrir les filtres"
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filtres
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1 text-[11px] font-semibold tabular-nums">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[88vw] !max-w-[340px] p-0 flex flex-col gap-0"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="h-4 w-4" />
              Filtres
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Recherche — pas dans un accordéon, accès direct. */}
            <div className="border-b p-4">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recherche
              </label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitSearch();
                      if (e.key === "Escape") clearSearch();
                    }}
                    placeholder="Domaine, entreprise, tel..."
                    className="h-10 pl-8 pr-8 text-sm"
                    inputMode="search"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      aria-label="Effacer la recherche"
                      className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button
                  size="sm"
                  className="h-10 px-3 text-xs"
                  onClick={submitSearch}
                >
                  OK
                </Button>
              </div>
            </div>

            {/* Volets accordéon — repliés par défaut. */}
            <Accordion type="multiple" className="px-4">
              {/* Secteur / Sans-site selon le segment courant. */}
              {siteMode === "without" ? (
                <AccordionItem value="sans-site">
                  <AccordionTrigger className="py-3.5">
                    <span className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      Sans site
                      {sansSiteActive && <ActiveDot />}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <SansSiteFilterBody
                      value={sansSiteFilter}
                      onChange={onChangeSansSite}
                    />
                  </AccordionContent>
                </AccordionItem>
              ) : (
                <AccordionItem value="secteur">
                  <AccordionTrigger className="py-3.5">
                    <span className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      Secteur
                      {sectorActive && <ActiveDot />}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <SectorFilterBody
                      selectedSecteurs={selectedSecteurs}
                      selectedDomaines={selectedDomaines}
                      onSelect={onSelectSecteurs}
                    />
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Géo / Taille / Qualité — ouvrent les Sheet existants.
                  Ce sont des sections d'accordéon sans contenu déroulant :
                  le trigger sert de bouton, le Sheet plein écran est déjà
                  mobile-friendly. */}
              <SheetLauncherItem
                icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
                label="Géographie"
                active={activeFilters.geo > 0}
                onClick={() => openSheet(onOpenGeo)}
              />
              <SheetLauncherItem
                icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
                label="Taille"
                active={activeFilters.taille > 0}
                onClick={() => openSheet(onOpenSize)}
              />
              <SheetLauncherItem
                icon={<Shield className="h-4 w-4 text-muted-foreground" />}
                label="Qualité"
                active={activeFilters.qualite > 0}
                onClick={() => openSheet(onOpenQuality)}
              />
            </Accordion>

            {/* Toggles directs — repris de l'ex-FilterBar. */}
            <div className="space-y-2 border-t p-4">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Options
              </span>
              <ToggleRow
                icon={<Smartphone className="h-4 w-4" />}
                label="Mobile uniquement (06/07)"
                active={mobileOnly}
                onClick={onToggleMobile}
              />
              <ToggleRow
                icon={<History className="h-4 w-4" />}
                label="Historique des contacts"
                active={isHistoriqueActive}
                onClick={isHistoriqueActive ? onClearHistorique : onHistorique}
              />
            </div>
          </div>

          {/* Pied : fermer / voir les résultats. */}
          <div className="border-t p-3">
            <Button
              className="h-11 w-full text-sm"
              onClick={() => setOpen(false)}
            >
              Voir les résultats
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Pastille "filtre actif" — discrète, à côté du libellé d'un volet. */
function ActiveDot() {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full bg-indigo-600"
      aria-label="filtre actif"
    />
  );
}

/**
 * Section d'accordéon qui se comporte comme un bouton : pas de contenu
 * déroulant, le clic ouvre un Sheet plein écran existant. On garde le
 * style visuel d'un AccordionItem (bordure, padding) pour l'homogénéité.
 */
function SheetLauncherItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[52px] w-full items-center justify-between gap-4 py-3.5 text-left text-sm font-medium transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
          {active && <ActiveDot />}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          Ouvrir
        </span>
      </button>
    </div>
  );
}

/** Ligne toggle on/off pleine largeur, cible tactile ≥ 44px. */
function ToggleRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-2.5 rounded-md border px-3 text-sm transition-colors",
        active
          ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
          : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span
        className={cn(
          "h-4 w-4 shrink-0 rounded-full border-2 transition-colors",
          active ? "border-indigo-600 bg-indigo-600" : "border-muted-foreground/40",
        )}
      />
    </button>
  );
}
