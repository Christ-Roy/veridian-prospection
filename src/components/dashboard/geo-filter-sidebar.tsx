"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, RotateCcw, Globe, Search } from "lucide-react";

// French regions with their department codes
const REGIONS: { name: string; depts: string[] }[] = [
  { name: "Auvergne-Rhone-Alpes", depts: ["01","03","07","15","26","38","42","43","63","69","73","74"] },
  { name: "Ile-de-France", depts: ["75","77","78","91","92","93","94","95"] },
  { name: "Provence-Alpes-Cote d'Azur", depts: ["04","05","06","13","83","84"] },
  { name: "Occitanie", depts: ["09","11","12","30","31","32","34","46","48","65","66","81","82"] },
  { name: "Nouvelle-Aquitaine", depts: ["16","17","19","23","24","33","40","47","64","79","86","87"] },
  { name: "Bretagne", depts: ["22","29","35","56"] },
  { name: "Pays de la Loire", depts: ["44","49","53","72","85"] },
  { name: "Normandie", depts: ["14","27","50","61","76"] },
  { name: "Hauts-de-France", depts: ["02","59","60","62","80"] },
  { name: "Grand Est", depts: ["08","10","51","52","54","55","57","67","68","88"] },
  { name: "Bourgogne-Franche-Comte", depts: ["21","25","39","58","70","71","89","90"] },
  { name: "Centre-Val de Loire", depts: ["18","28","36","37","41","45"] },
  { name: "Corse", depts: ["2A","2B"] },
];

// All department codes (flat list from all regions)
const ALL_DEPTS = REGIONS.flatMap(r => r.depts);

// Department names for readable labels
const DEPT_NAMES: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Hte-Provence",
  "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardeche", "08": "Ardennes",
  "09": "Ariege", "10": "Aube", "11": "Aude", "12": "Aveyron",
  "13": "Bouches-du-Rhone", "14": "Calvados", "15": "Cantal", "16": "Charente",
  "17": "Charente-Maritime", "18": "Cher", "19": "Correze", "2A": "Corse-du-Sud",
  "2B": "Haute-Corse", "21": "Cote-d'Or", "22": "Cotes-d'Armor", "23": "Creuse",
  "24": "Dordogne", "25": "Doubs", "26": "Drome", "27": "Eure",
  "28": "Eure-et-Loir", "29": "Finistere", "30": "Gard", "31": "Haute-Garonne",
  "32": "Gers", "33": "Gironde", "34": "Herault", "35": "Ille-et-Vilaine",
  "36": "Indre", "37": "Indre-et-Loire", "38": "Isere", "39": "Jura",
  "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
  "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne",
  "48": "Lozere", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
  "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle", "55": "Meuse",
  "56": "Morbihan", "57": "Moselle", "58": "Nievre", "59": "Nord",
  "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dome",
  "64": "Pyrenees-Atlantiques", "65": "Hautes-Pyrenees", "66": "Pyrenees-Orientales",
  "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhone", "70": "Haute-Saone",
  "71": "Saone-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
  "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines",
  "79": "Deux-Sevres", "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne",
  "83": "Var", "84": "Vaucluse", "85": "Vendee", "86": "Vienne",
  "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
  "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne", "95": "Val-d'Oise",
};

interface GeoFilterSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDepts: string[];
  onApply: (depts: string[]) => void;
}

export function GeoFilterSidebar({ open, onOpenChange, selectedDepts, onApply }: GeoFilterSidebarProps) {
  const [depts, setDepts] = useState<Set<string>>(new Set(selectedDepts));
  const [search, setSearch] = useState("");

  // Reset local state when opening
  useEffect(() => {
    if (open) {
      setDepts(new Set(selectedDepts));
      setSearch("");
    }
  }, [open, selectedDepts]);

  const filteredRegions = useMemo(() => {
    if (!search.trim()) return REGIONS;
    const q = search.toLowerCase();
    return REGIONS.map(r => ({
      ...r,
      depts: r.depts.filter(d =>
        d.toLowerCase().includes(q) ||
        (DEPT_NAMES[d] ?? "").toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
      ),
    })).filter(r => r.depts.length > 0);
  }, [search]);

  function toggleDept(dept: string) {
    setDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  }

  function toggleRegion(regionDepts: string[]) {
    setDepts(prev => {
      const next = new Set(prev);
      const allSelected = regionDepts.every(d => next.has(d));
      if (allSelected) regionDepts.forEach(d => next.delete(d));
      else regionDepts.forEach(d => next.add(d));
      return next;
    });
  }

  function selectAll() {
    setDepts(new Set(ALL_DEPTS));
  }

  function reset() {
    setDepts(new Set());
  }

  function handleApply() {
    onApply(Array.from(depts));
    onOpenChange(false);
  }

  const count = depts.size;
  const isNational = count === ALL_DEPTS.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Filtre Geographie
          </SheetTitle>
          <SheetDescription>
            {count === 0
              ? "Aucun departement selectionne (pas de filtre)"
              : isNational
              ? "National (tous les departements)"
              : `${count} departement${count > 1 ? "s" : ""} selectionne${count > 1 ? "s" : ""}`}
          </SheetDescription>
        </SheetHeader>

        {/* Quick actions */}
        <div className="flex items-center gap-2 px-4">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={selectAll}>
            <Globe className="h-3 w-3" /> National
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={reset}>
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
          {count > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {count} dept{count > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Search */}
        <div className="px-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un departement..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {/* Department list */}
        <div className="flex-1 overflow-y-auto px-4 space-y-3">
          {filteredRegions.map(region => {
            const allRegionSelected = region.depts.every(d => depts.has(d));
            const someRegionSelected = region.depts.some(d => depts.has(d));
            return (
              <div key={region.name} className="space-y-1">
                <div
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1"
                  onClick={() => toggleRegion(region.depts)}
                >
                  <Checkbox
                    checked={allRegionSelected ? true : someRegionSelected ? "indeterminate" : false}
                    onCheckedChange={() => toggleRegion(region.depts)}
                  />
                  <span className="text-sm font-semibold text-foreground">{region.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {region.depts.filter(d => depts.has(d)).length}/{region.depts.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-0.5 pl-4">
                  {region.depts.map(dept => (
                    <label
                      key={dept}
                      className="flex items-center gap-1.5 cursor-pointer hover:bg-muted/30 rounded px-1.5 py-0.5"
                    >
                      <Checkbox
                        checked={depts.has(dept)}
                        onCheckedChange={() => toggleDept(dept)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs">
                        <span className="font-mono text-muted-foreground">{dept}</span>
                        {" "}
                        {DEPT_NAMES[dept] ?? dept}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <SheetFooter className="border-t pt-4">
          <Button onClick={handleApply} className="w-full">
            Appliquer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
