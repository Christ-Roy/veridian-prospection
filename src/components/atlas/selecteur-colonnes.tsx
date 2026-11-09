"use client";

import { Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { grouperChamps } from "./logique";
import type { ChampInfo } from "./types";

const MAX = 25;

export function SelecteurColonnes({ champs, colonnes, onChange }: { champs: ChampInfo[]; colonnes: string[]; onChange: (c: string[]) => void }) {
  const bascule = (id: string) => {
    if (colonnes.includes(id)) onChange(colonnes.filter((c) => c !== id));
    else if (colonnes.length < MAX) onChange([...colonnes, id]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 /> Colonnes <span className="text-muted-foreground">{colonnes.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <p className="mb-2 text-xs text-muted-foreground">{colonnes.length} sur {MAX} colonnes.</p>
        {grouperChamps(champs).map((g) => (
          <fieldset key={g.groupe} className="mb-3">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">{g.groupe}</legend>
            {g.champs.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                <Checkbox checked={colonnes.includes(c.id)} onCheckedChange={() => bascule(c.id)} disabled={!colonnes.includes(c.id) && colonnes.length >= MAX} />
                {c.libelle}
              </label>
            ))}
          </fieldset>
        ))}
      </PopoverContent>
    </Popover>
  );
}
