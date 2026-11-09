"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

import { nouvelleLigne, type LigneEditeur } from "./lignes";
import { ajouterValeurs, grouperChamps, libelleOperateur, operateurParDefaut, saisieVide, type Saisie } from "./logique";
import type { ChampInfo } from "./types";

type Props = {
  champs: ChampInfo[];
  index: ReadonlyMap<string, ChampInfo>;
  lignes: LigneEditeur[];
  onChange: (l: LigneEditeur[]) => void;
  /** Critères de scoring : chaque ligne porte un poids. */
  avecPoids?: boolean;
};

export function EditeurConditions({ champs, index, lignes, onChange, avecPoids }: Props) {
  const groupes = grouperChamps(champs);
  const maj = (cle: string, patch: Partial<LigneEditeur>) => onChange(lignes.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-3">
      {lignes.length === 0 && <p className="text-sm text-muted-foreground">{avecPoids ? "Aucune règle." : "Aucune condition : toutes les entreprises."}</p>}
      {lignes.map((l) => {
        const champ = index.get(l.champ);
        if (!champ) return null;
        return (
          <div key={l.cle} className="flex flex-col gap-2 rounded-lg border p-3" role="group" aria-label={champ.libelle}>
            <div className="flex items-center gap-2">
              <Select
                value={l.champ}
                onValueChange={(id) => {
                  const c = index.get(id);
                  if (c) maj(l.cle, { champ: id, op: operateurParDefaut(c), saisie: saisieVide() });
                }}
              >
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Champ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupes.map((g) => (
                    <SelectGroup key={g.groupe}>
                      <SelectLabel>{g.groupe}</SelectLabel>
                      {g.champs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.libelle}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Retirer la condition ${champ.libelle}`} onClick={() => onChange(lignes.filter((x) => x.cle !== l.cle))}>
                <X />
              </Button>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {champ.operateurs.length > 1 && (
                <Select value={l.op} onValueChange={(op) => maj(l.cle, { op })}>
                  <SelectTrigger size="sm" aria-label="Opérateur">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {champ.operateurs.map((op) => (
                      <SelectItem key={op} value={op}>
                        {libelleOperateur(op, champ.type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <ChampValeur champ={champ} op={l.op} saisie={l.saisie} onChange={(saisie) => maj(l.cle, { saisie })} />
              {avecPoids && (
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  + points
                  <Input
                    inputMode="decimal"
                    className="h-8 w-20"
                    value={l.poids}
                    onChange={(e) => maj(l.cle, { poids: e.target.value })}
                    aria-label={`Points de la règle ${champ.libelle}`}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
      <Select
        value=""
        onValueChange={(id) => {
          const c = index.get(id);
          if (c) onChange([...lignes, nouvelleLigne(c)]);
        }}
      >
        <SelectTrigger size="sm" className="w-full" aria-label={avecPoids ? "Ajouter une règle" : "Ajouter une condition"}>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Plus className="size-4" />
            {avecPoids ? "Ajouter une règle" : "Ajouter une condition"}
          </span>
        </SelectTrigger>
        <SelectContent>
          {groupes.map((g) => (
            <SelectGroup key={g.groupe}>
              <SelectLabel>{g.groupe}</SelectLabel>
              {g.champs.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.libelle}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ChampValeur({ champ, op, saisie, onChange }: { champ: ChampInfo; op: string; saisie: Saisie; onChange: (s: Saisie) => void }) {
  const [brut, setBrut] = useState("");
  const set = (patch: Partial<Saisie>) => onChange({ ...saisie, ...patch });

  if (op === "renseigne" || champ.type === "oui_non") {
    return (
      <Select value={saisie.oui ? "oui" : "non"} onValueChange={(v) => set({ oui: v === "oui" })}>
        <SelectTrigger size="sm" aria-label="Valeur">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="oui">{op === "renseigne" ? "Renseigné" : "Oui"}</SelectItem>
          <SelectItem value="non">{op === "renseigne" ? "Non renseigné" : "Non"}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (champ.type === "liste") {
    const valider = () => {
      if (brut.trim()) onChange({ ...saisie, liste: ajouterValeurs(saisie.liste, brut) });
      setBrut("");
    };
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap gap-1">
          {saisie.liste.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {v}
              <button type="button" aria-label={`Retirer ${v}`} className="rounded-full hover:text-foreground focus-visible:ring-2" onClick={() => set({ liste: saisie.liste.filter((x) => x !== v) })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <Input
          className="h-8"
          placeholder="Valeur, puis Entrée (ou virgule)"
          aria-label={`Valeurs pour ${champ.libelle}`}
          value={brut}
          onChange={(e) => (/[,;]$/.test(e.target.value) ? (onChange({ ...saisie, liste: ajouterValeurs(saisie.liste, e.target.value) }), setBrut("")) : setBrut(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              valider();
            }
          }}
          onBlur={valider}
        />
      </div>
    );
  }
  if (champ.type === "nombre") {
    const un = (cle: "min" | "max", label: string) => (
      <Input key={cle} inputMode="decimal" className="h-8 w-28" placeholder={label} aria-label={`${champ.libelle} ${label}`} value={saisie[cle]} onChange={(e) => set({ [cle]: e.target.value })} />
    );
    return op === "entre" ? (
      <div className="flex items-center gap-1.5">
        {un("min", "min")}
        <span className="text-sm text-muted-foreground">et</span>
        {un("max", "max")}
      </div>
    ) : (
      un(op === "max" ? "max" : "min", "nombre")
    );
  }
  if (champ.type === "date") {
    return <Input type="date" className="h-8 w-40" aria-label={`${champ.libelle} date`} value={saisie.texte} onChange={(e) => set({ texte: e.target.value })} />;
  }
  return <Input className="h-8 min-w-0 flex-1" placeholder="Texte" aria-label={`${champ.libelle} texte`} value={saisie.texte} onChange={(e) => set({ texte: e.target.value })} />;
}
