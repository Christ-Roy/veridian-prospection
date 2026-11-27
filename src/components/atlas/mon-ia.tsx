"use client";
/**
 * Fenêtre « Mon IA » (CONTRAT-HUB §5.24.1). L'affichage vient du serveur (`connexions_ia.mon_ia`, état lu au Hub) :
 * `cadre` = moteur branché, le cadre du Hub qui répond ; `carte` = sans moteur, la carte « Relier mon IA » et JAMAIS le
 * cadre (une fenêtre qui refuserait chaque question ne s'affiche pas) ; null = rien (éteinte, Hub muet).
 * Jamais de champ ni de mot « clé » proposé (règle de Robert du 25/11).
 */
import { useState } from "react";

import type { AffichageMonIA } from "@/lib/hub/ia-etat";

import type { LiensIA } from "./ia";
import { Icone } from "./icones";

type Props = { affichage: AffichageMonIA; hub: string; organisationHub: string | null; liens: LiensIA | null; onFermer: () => void };

function Copier({ texte, libelle }: { texte: string; libelle: string }) {
  const [fait, setFait] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        void navigator.clipboard?.writeText(texte).then(() => {
          setFait(true);
          setTimeout(() => setFait(false), 1500);
        });
      }}
    >
      {fait ? "Copié" : libelle}
    </button>
  );
}

/**
 * La carte sans moteur (§5.24.1, « Contenu de la carte sans moteur »), dans cet ordre : un bouton par assistant (liens lus au
 * Hub, étape affichée quand elle n'est pas nulle), l'adresse MCP à copier, la commande Claude Code, puis le lien vers le Hub.
 * Sans liens (Hub muet) : le texte et le lien seuls. La liste des IA reliées et la révocation restent au Hub.
 */
export function CarteRelierMonIA({ hub, liens }: { hub: string; liens: LiensIA | null }) {
  const assistants = liens?.assistants ?? [];
  return (
    <div className="mon-ia-carte" data-carte="relier-mon-ia">
      <b>Relier mon IA</b>
      <p>Votre IA travaille dans vos apps Veridian depuis son propre écran (Claude, ChatGPT, Mistral…) : reliez-la une fois, sans clé.</p>
      {assistants.length > 0 && (
        <div className="ia-boutons">
          {assistants.map((a, i) => (
            <div key={a.cle} className="ia-assistant" data-assistant={a.cle}>
              <a className={i === 0 ? "btn pri" : "btn"} href={a.installation} target="_blank" rel="noopener noreferrer">
                {a.libelle}
              </a>
              {a.etape && <p className="hint">{a.etape}</p>}
            </div>
          ))}
        </div>
      )}
      {liens && (
        <div className="ia-copie">
          <span className="lbl">Adresse MCP</span>
          <code>{liens.url}</code>
          <Copier texte={liens.url} libelle="Copier l'adresse" />
          {liens.claudeCode && (
            <>
              <span className="lbl">Claude Code</span>
              <code>{liens.claudeCode}</code>
              <Copier texte={liens.claudeCode} libelle="Copier la commande" />
            </>
          )}
        </div>
      )}
      <a className={assistants.length ? "btn" : "btn pri"} href={`${hub}/dashboard/ia`} target="_blank" rel="noopener noreferrer">
        Relier mon IA
      </a>
    </div>
  );
}

/**
 * Le bouton de la barre, avec la marque commune `data-mon-ia` (§5.24.1, cas 56 du Hub) : « Mon IA » quand un moteur répond,
 * « Relier mon IA » sans moteur ; rien sinon. Le cadre n'est jamais inséré avant le clic.
 */
export function BoutonMonIA({ affichage, ouvert, onBasculer }: { affichage: AffichageMonIA; ouvert: boolean; onBasculer: () => void }) {
  if (!affichage) return null;
  const pret = affichage === "cadre";
  // La marque est le conteneur, le bouton est dedans : le cas 56 du Hub clique `[data-mon-ia] button` (b3ff834, 27/11).
  return (
    <span className="mon-ia-marque" data-mon-ia={pret ? "prete" : "sans_moteur"}>
      <button
        type="button"
        className={ouvert ? "btn ghost on" : "btn ghost"}
        title={pret ? "Discuter avec votre IA, qui agit dans Atlas" : "Relier votre IA à vos apps Veridian"}
        aria-expanded={ouvert}
        aria-controls="atlas-mon-ia"
        onClick={onBasculer}
      >
        {pret ? "Mon IA" : "Relier mon IA"}
      </button>
    </span>
  );
}

export function FenetreMonIA({ affichage, hub, organisationHub, liens, onFermer }: Props) {
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
        <CarteRelierMonIA hub={hub} liens={liens} />
      )}
    </aside>
  );
}
