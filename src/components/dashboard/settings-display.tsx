"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { AllSettings } from "./settings-tabs";

interface Props {
  settings: AllSettings;
  update: <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => void;
}

export function SettingsDisplay({ settings, update }: Props) {
  return (
    <div className="space-y-6">
      {/* Affichage */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Affichage</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Taille de page</Label>
            <div className="flex gap-2">
              {["25", "50", "100"].map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={settings.page_size === v ? "default" : "outline"}
                  className="h-8 w-16"
                  onClick={() => update("page_size", v)}
                >
                  {v}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Preset par defaut</Label>
            <div className="flex gap-2 flex-wrap">
              {[
                { id: "top_prospects", label: "Top Prospects" },
                { id: "btp_artisans", label: "BTP & Artisans" },
                { id: "sante_droit", label: "Sante & Droit" },
                { id: "commerce_services", label: "Commerce" },
                { id: "tous", label: "Tous" },
                { id: "historique", label: "Historique" },
              ].map((t) => (
                <Button
                  key={t.id}
                  size="sm"
                  variant={settings.default_tab === t.id ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => update("default_tab", t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Filtres par defaut */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Filtres par defaut</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Departements par defaut</Label>
            <Input
              placeholder="ex: 69,42,38 (vide = tous)"
              value={settings.default_dept}
              onChange={(e) => update("default_dept", e.target.value)}
              className="h-8 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Codes dept separes par virgule. Vide = pas de filtre.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Taille par defaut</Label>
            <div className="flex gap-2">
              {[
                { id: "all", label: "Tous" },
                { id: "individuel", label: "Indiv." },
                { id: "pme", label: "PME" },
                { id: "grande", label: "Grande" },
              ].map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={settings.default_size === s.id ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => update("default_size", s.id)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Score technique minimum</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.default_min_tech_score}
              onChange={(e) => update("default_min_tech_score", e.target.value)}
              className="h-8 text-sm w-24"
            />
            <p className="text-xs text-muted-foreground">
              0 = pas de filtre. Plus le score est eleve, plus le site est obsolete.
            </p>
          </div>
        </div>
      </Card>

      {/* Navigation */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Navigation</h2>
        <div className="flex items-center gap-3">
          <Checkbox
            id="show_guide"
            checked={settings.show_guide === "true"}
            onCheckedChange={(checked) => update("show_guide", checked ? "true" : "false")}
          />
          <Label htmlFor="show_guide" className="text-sm cursor-pointer">
            Afficher le Guide commercial dans la navigation
          </Label>
        </div>
      </Card>

      {/* Presets sectoriels - lecture seule */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Presets sectoriels</h2>
        <p className="text-sm text-muted-foreground">
          Les presets filtrent les prospects par secteur NAF. Tous partagent une base
          commune : enrichi, actif, pas association, pas procedure collective.
        </p>

        <div className="space-y-3 text-sm">
          <div className="border rounded p-3 bg-amber-50">
            <p className="font-semibold text-amber-600">Top Prospects</p>
            <ul className="mt-1 text-xs text-amber-600/80 space-y-0.5">
              <li>Score eclate &gt;= 2/3 (site vraiment obsolete)</li>
              <li>Telephone renseigne</li>
              <li>Toutes categories NAF confondues</li>
            </ul>
          </div>

          <div className="border rounded p-3 bg-orange-50">
            <p className="font-semibold text-orange-600">BTP &amp; Artisans</p>
            <ul className="mt-1 text-xs text-orange-600/80 space-y-0.5">
              <li>NAF 41.xx (construction batiment) et 43.xx (travaux specialises)</li>
              <li>Plomberie, electricite, maconnerie, renovation, couverture</li>
            </ul>
          </div>

          <div className="border rounded p-3 bg-blue-50">
            <p className="font-semibold text-blue-600">Sante &amp; Droit</p>
            <ul className="mt-1 text-xs text-blue-600/80 space-y-0.5">
              <li>NAF 86.xx (sante), 69.xx (droit/comptabilite), 71.xx (archi/ingenierie)</li>
              <li>Medecins, dentistes, kines, avocats, comptables, architectes</li>
            </ul>
          </div>

          <div className="border rounded p-3 bg-green-50">
            <p className="font-semibold text-green-600">Commerce &amp; Services</p>
            <ul className="mt-1 text-xs text-green-600/80 space-y-0.5">
              <li>
                NAF 55/56.xx (hotel/resto), 45.xx (auto), 47.xx (commerce), 96.xx
                (beaute), 93.xx (sport)
              </li>
              <li>Restaurants, hotels, garages, commerces, beaute, sport</li>
            </ul>
          </div>

          <div className="border rounded p-3 bg-gray-50">
            <p className="font-semibold text-gray-600">Tous</p>
            <ul className="mt-1 text-xs text-gray-500 space-y-0.5">
              <li>Tous les enrichis avec telephone, toutes categories NAF</li>
            </ul>
          </div>

          <div className="border rounded p-3 bg-indigo-50">
            <p className="font-semibold text-indigo-600">Historique</p>
            <ul className="mt-1 text-xs text-indigo-600/80 space-y-0.5">
              <li>Prospects deja consultes (avec date de derniere visite)</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
