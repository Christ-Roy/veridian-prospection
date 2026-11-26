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

/**
 * Le bouton de la barre, avec la marque commune `data-mon-ia` (§5.24.1, cas 56 du Hub) : « Mon IA » quand un moteur répond,
 * « Relier mon IA » sans moteur ; rien sinon. Le cadre n'est jamais inséré avant le clic.
 */
export function BoutonMonIA({ affichage, ouvert, onBasculer }: { affichage: AffichageMonIA; ouvert: boolean; onBasculer: () => void }) {
  if (!affichage) return null;
  const pret = affichage === "cadre";
  return (
    <button
      type="button"
      className={ouvert ? "btn ghost on" : "btn ghost"}
      data-mon-ia={pret ? "prete" : "sans_moteur"}
      title={pret ? "Discuter avec votre IA, qui agit dans Atlas" : "Relier votre IA à vos apps Veridian"}
      aria-expanded={ouvert}
      aria-controls="atlas-mon-ia"
      onClick={onBasculer}
    >
      {pret ? "Mon IA" : "Relier mon IA"}
    </button>
  );
}

export function FenetreMonIA({ affichage, hub, organisationHub, onFermer }: Props) {
  if (!affichage || !organisationHub) return null;
  return (
    <aside id="atlas-mon-ia" className="mon-ia" role="dialog" aria-label="Mon IA" data-affichage={affichage}>
      <div className="mon-ia-tete">
        <b>Mon IA</b>
        <button type="button" className="x" aria-label="Fermer Mon IA" onClick={onFermer}>
          <Icone nom="x" />
        </button>
      </div>
      {affichage === "cadre" ? (
        <iframe title="Mon IA" src={`${hub}/ia/chat?app=prospection&tenant=${encodeURIComponent(organisationHub)}`} allow="clipboard-write" />
      ) : (
        <div className="mon-ia-carte" data-carte="relier-mon-ia">
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
