"use client";
/**
 * Fenêtre « Mon IA » (CONTRAT-HUB §5.24.1). L'affichage vient du serveur (`connexions_ia.mon_ia`, état lu au Hub) :
 * `cadre` = moteur branché, le cadre du Hub qui répond ; `carte` = sans moteur, la carte « Relier mon IA » et JAMAIS le
 * cadre (une fenêtre qui refuserait chaque question ne s'affiche pas) ; null = rien (éteinte, Hub muet).
 * Jamais de champ ni de mot « clé » proposé (règle de Robert du 25/11).
 */
import type { AffichageMonIA } from "@/lib/hub/ia-etat";

import { Icone } from "./icones";

type Props = { affichage: AffichageMonIA; hub: string; organisationHub: string | null; onFermer: () => void };

export function FenetreMonIA({ affichage, hub, organisationHub, onFermer }: Props) {
  if (!affichage || !organisationHub) return null;
  return (
    <aside id="atlas-mon-ia" className="mon-ia" aria-label="Mon IA" data-affichage={affichage}>
      <div className="mon-ia-tete">
        <b>Mon IA</b>
        <button type="button" className="x" aria-label="Fermer Mon IA" onClick={onFermer}>
          <Icone nom="x" />
        </button>
      </div>
      {affichage === "cadre" ? (
        <iframe title="Mon IA" src={`${hub}/ia/chat?app=prospection&tenant=${encodeURIComponent(organisationHub)}`} allow="clipboard-write" />
      ) : (
        <div className="mon-ia-carte">
          <b>Relier mon IA</b>
          <p>Votre IA travaille dans vos apps Veridian depuis son propre écran (Claude, ChatGPT, Mistral…) : reliez-la une fois, sans clé.</p>
          <a className="btn pri" href={`${hub}/dashboard/ia`} target="_blank" rel="noopener noreferrer">
            Relier mon IA
          </a>
        </div>
      )}
    </aside>
  );
}
