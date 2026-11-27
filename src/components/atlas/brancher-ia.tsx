"use client";

/** Premier passage (aucun marché) : avec l'IA, recommandé (ouvre la fenêtre « Mon IA », seul point d'entrée IA, §5.24.1), ou à la main. */
export function Accueil({ onIA, onManuel, onFermer }: { onIA: (() => void) | null; onManuel: () => void; onFermer: () => void }) {
  return (
    <div className="dlg" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="dlg-box accueil" role="dialog" aria-modal="false" aria-labelledby="atlas-accueil-titre">
        <h2 id="atlas-accueil-titre">Bienvenue dans Atlas</h2>
        <p>Trouvez votre marché parmi toutes les entreprises de France, découpez-le en cibles, puis classez les prospects à contacter en premier.</p>
        {onIA && (
        <button type="button" className="choix reco" onClick={onIA}>
          <span className="tag">Hautement recommandé</span>
          <b>Avec mon IA</b>
          <span>Branchez Claude ou ChatGPT : décrivez ce que vous vendez, l&apos;IA construit le marché, les cibles et la priorité. Vous gardez la main sur tout.</span>
        </button>
        )}
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
