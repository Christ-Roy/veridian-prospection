"use client";

import { signOut, useSession } from "next-auth/react";

import { ciblesDe, marcheDe, sectionsRail, type IAVue } from "./flux";
import { Icone } from "./icones";
import type { Arbre, SegmentArbre } from "./types";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";
/** Page du Hub où l'on branche Claude, ChatGPT, Cursor… (une seule connexion pour toutes les apps). */
export const HUB_IA = `${HUB}/dashboard/ia`;

export type { IAVue } from "./flux";

type Props = {
  arbre: Arbre | null;
  erreur: string | null;
  selection: string | null;
  ouvert: boolean;
  peutEcrire: boolean;
  ias: IAVue[];
  onBrancherIA: () => void;
  clignote: string | null;
  onSelection: (id: string | null) => void;
  onCreer: (type: "dossier" | "marche" | "cible", marche?: SegmentArbre) => void;
};

/**
 * Rail de la maquette : 56 px d'icônes, 268 px au survol ou au focus, libellés en fondu. Les marchés
 * sont rangés par dossier ; le marché actif déploie ses cibles. Sous 720 px, c'est un menu.
 */
export function Rail({ arbre, erreur, selection, ouvert, peutEcrire, ias, onBrancherIA, clignote, onSelection, onCreer }: Props) {
  const { data: session } = useSession();
  const email = session?.user?.email ?? null;
  const marcheActif = arbre && selection ? marcheDe(arbre, selection) : null;
  const item = (s: SegmentArbre, sub: number) => {
    const on = s.id === selection;
    return (
      <button
        key={s.id}
        type="button"
        className={`ritem${sub ? " sub" : ""}${on ? " on" : ""}${clignote === s.id ? " flash" : ""}`}
        style={sub > 1 ? { paddingLeft: 36 + (sub - 1) * 12 } : undefined}
        aria-current={on ? "page" : undefined}
        title={s.nom}
        onClick={() => onSelection(s.id)}
      >
        <Icone nom={sub ? "cible" : "carte"} />
        <span className="lbl">{s.nom}</span>
        <span className="n lbl">v{s.version}</span>
      </button>
    );
  };

  return (
    <nav className={ouvert ? "rail open" : "rail"} id="atlas-rail" aria-label="Marchés et cibles">
      <div className="logo">
        <i />
        <span className="lbl">Atlas</span>
      </div>
      <div className="scroll">
        <div className="rsec">
          <button type="button" className={selection === null ? "ritem on" : "ritem"} aria-current={selection === null ? "page" : undefined} title="Explorer tout le marché" onClick={() => onSelection(null)}>
            <Icone nom="vue" />
            <span className="lbl">Explorer tout le marché</span>
          </button>
        </div>

        {!arbre && !erreur && (
          <div className="rsec">
            <div className="rhead lbl">Chargement des marchés…</div>
          </div>
        )}
        {erreur && (
          <div className="rsec">
            <div className="rhead lbl" role="alert">
              {erreur}
            </div>
          </div>
        )}
        {arbre &&
          sectionsRail(arbre).map((sec) => (
            <div className="rsec" key={sec.id || "libres"}>
              <div className="rhead lbl">{sec.nom}</div>
              {sec.marches.map((m) => (
                <div key={m.id} style={{ display: "contents" }}>
                  {item(m, 0)}
                  {marcheActif?.id === m.id && ciblesDe(arbre, m.id).map((c) => item(c.segment, c.profondeur))}
                  {marcheActif?.id === m.id && peutEcrire && (
                    <button type="button" className="ritem sub add" title="Nouvelle cible" onClick={() => onCreer("cible", m)}>
                      <Icone nom="plus" />
                      <span className="lbl">Nouvelle cible</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        {arbre && arbre.segments.length === 0 && (
          <div className="rsec">
            <div className="rhead lbl">Aucun marché pour l&apos;instant</div>
          </div>
        )}
        {peutEcrire && arbre && (
          <div className="rsec">
            <button type="button" className="ritem add" title="Nouveau marché" onClick={() => onCreer("marche")}>
              <Icone nom="plus" />
              <span className="lbl">Nouveau marché</span>
            </button>
            <button type="button" className="ritem add" title="Nouveau dossier" onClick={() => onCreer("dossier")}>
              <Icone nom="dossier" />
              <span className="lbl">Nouveau dossier</span>
            </button>
          </div>
        )}

        <div className="rsec">
          <div className="rhead lbl">Segments Notifuse</div>
          <div className="ritem later" title="Envoi des cibles classées vers Notifuse : bientôt">
            <Icone nom="segment" />
            <span className="lbl">Envoi des cibles · bientôt</span>
          </div>
        </div>
        <div className="fill" />
      </div>

      <div className="rsec" style={{ marginBottom: 0 }}>
        <div className="rhead lbl">Connexions IA</div>
        {ias.length === 0 ? (
          <div className="conn">
            <span className="d" style={{ background: "var(--off-line)" }} />
            <span className="lbl">Aucune IA branchée</span>
          </div>
        ) : (
          ias.map((ia) => (
            <div className="conn" key={ia.nom}>
              <span className="d" style={{ background: ia.etat === "active" ? "var(--ok)" : "var(--blue)" }} />
              <span className="lbl">{ia.etat === "active" ? `${ia.nom} · active à ${ia.heure}` : `${ia.nom} · branchée, dernier échange ${ia.heure}`}</span>
            </div>
          ))
        )}
        <button type="button" className="conn" style={{ width: "100%", textAlign: "left" }} title="Brancher Claude, ChatGPT ou Cursor" onClick={onBrancherIA}>
          <Icone nom="plus" />
          <span className="lbl">{ias.length ? "Brancher une autre IA" : "Brancher une IA"}</span>
        </button>
        <button type="button" className="conn" style={{ width: "100%", textAlign: "left" }} title={email ? `Se déconnecter (${email})` : "Se déconnecter"} onClick={() => void signOut({ callbackUrl: "/login", redirect: true })}>
          <Icone nom="retour" />
          <span className="lbl">{email ? `Se déconnecter · ${email}` : "Se déconnecter"}</span>
        </button>
      </div>
    </nav>
  );
}
