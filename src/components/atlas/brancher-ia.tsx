"use client";

import { useEffect, useRef, useState } from "react";

import { PREMIERE_DEMANDE, boutonsIA, type LiensIA } from "./ia";

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
 * Brancher son IA sans quitter Atlas : boutons Claude, ChatGPT, Cursor, VS Code (liens servis par le
 * Hub, seule source), puis une première demande à copier. Sans liens (Hub injoignable), la page IA du Hub.
 */
export function DialogueIA({ liens, pageHub, onFermer }: { liens: LiensIA | null; pageHub: string; onFermer: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("a, button")?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);
  const boutons = boutonsIA(liens);
  return (
    <div className="dlg" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="dlg-box ia" role="dialog" aria-modal="true" aria-labelledby="atlas-ia-titre" ref={ref}>
        <h2 id="atlas-ia-titre">Brancher votre IA</h2>
        <p>
          Votre abonnement Claude ou ChatGPT pilote Atlas : il explore le marché, crée les cibles et règle la priorité, et l&apos;écran suit en direct. Une
          seule connexion sert toutes les apps Veridian ; vous vous connectez puis autorisez.
        </p>
        {boutons.length > 0 ? (
          <div className="ia-boutons">
            {boutons.map((b) => (
              <a key={b.id} className={b.id === "claude" ? "btn pri" : "btn"} href={b.href} target="_blank" rel="noopener noreferrer">
                {b.libelle}
              </a>
            ))}
          </div>
        ) : (
          <a className="btn pri" href={pageHub} target="_blank" rel="noopener noreferrer">
            Ouvrir la page IA du Hub
          </a>
        )}
        {liens?.aideChatgpt && <p className="hint">{liens.aideChatgpt}</p>}
        {liens && (
          <div className="ia-copie">
            <code>{liens.url}</code>
            <Copier texte={liens.url} libelle="Copier l'adresse" />
            {liens.claudeCode && <Copier texte={liens.claudeCode} libelle="Commande Claude Code" />}
          </div>
        )}
        <div className="ia-demande">
          <b>Ensuite, demandez par exemple :</b>
          <q>{PREMIERE_DEMANDE}</q>
          <Copier texte={PREMIERE_DEMANDE} libelle="Copier la demande" />
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={onFermer}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/** Premier passage (aucun marché) : avec l'IA, recommandé, ou à la main. */
export function Accueil({ onIA, onManuel, onFermer }: { onIA: () => void; onManuel: () => void; onFermer: () => void }) {
  return (
    <div className="dlg" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="dlg-box accueil" role="dialog" aria-modal="true" aria-labelledby="atlas-accueil-titre">
        <h2 id="atlas-accueil-titre">Bienvenue dans Atlas</h2>
        <p>Trouvez votre marché parmi toutes les entreprises de France, découpez-le en cibles, puis classez les prospects à contacter en premier.</p>
        <button type="button" className="choix reco" onClick={onIA}>
          <span className="tag">Hautement recommandé</span>
          <b>Avec mon IA</b>
          <span>Branchez Claude ou ChatGPT : décrivez ce que vous vendez, l&apos;IA construit le marché, les cibles et la priorité. Vous gardez la main sur tout.</span>
        </button>
        <button type="button" className="choix" onClick={onManuel}>
          <b>À la main</b>
          <span>Créez votre premier marché et ajoutez vous-même les filtres.</span>
        </button>
        <div className="row">
          <button type="button" className="btn" onClick={onFermer}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
