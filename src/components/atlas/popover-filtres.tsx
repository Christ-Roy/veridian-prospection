"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ClavierReact } from "react";

import { appeler, estAnnulation } from "./api";
import { ajouterValeurs, construireCondition, grouperChamps, libelleOperateur, operateurParDefaut, phraseCondition, saisieDepuis, saisieVide, type Saisie } from "./logique";
import type { ChampInfo, Condition, Filtre, RepartitionMarche } from "./types";

type Edition = { index: number | null; champ: string; op: string; saisie: Saisie };

type Props = {
  champs: ChampInfo[];
  index: ReadonlyMap<string, ChampInfo>;
  propres: Condition[];
  heritees: Condition[];
  inclureBloques: boolean;
  lectureSeule: boolean;
  onChange: (f: Filtre) => void;
  onFermer: () => void;
};

/**
 * Panneau de filtres de la maquette : une ligne par thème du catalogue, les conditions en pastilles,
 * « + ajouter » en liste pointillée. Une pastille s'édite en bas du panneau ; les valeurs d'un champ
 * de liste sont proposées depuis la répartition réelle (repartir_marche).
 */
export function PopoverFiltres({ champs, index, propres, heritees, inclureBloques, lectureSeule, onChange, onFermer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      const t = e.target as Element;
      // Les menus déroulants shadcn vivent dans un portail : un clic dedans n'est pas « dehors ».
      if (!ref.current?.contains(t) && !t.closest?.("[data-atlas-filtres]") && !t.closest?.("[data-radix-popper-content-wrapper]")) onFermer();
    };
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [onFermer]);

  const commencer = (champId: string, i: number | null) => {
    const champ = index.get(champId);
    if (!champ || lectureSeule) return;
    const c = i === null ? null : propres[i];
    setEdition({ index: i, champ: champId, op: c?.op ?? operateurParDefaut(champ), saisie: c ? saisieDepuis(c) : saisieVide() });
    setMsg(null);
  };

  const appliquer = () => {
    if (!edition) return;
    const champ = index.get(edition.champ);
    if (!champ) return;
    const r = construireCondition(champ, edition.op, edition.saisie);
    if (!r.ok) return setMsg(r.erreur);
    const conditions = edition.index === null ? [...propres, r.condition] : propres.map((c, i) => (i === edition.index ? r.condition : c));
    onChange({ conditions, inclure_bloques: inclureBloques });
    setEdition(null);
  };

  const retirer = (i: number) => {
    onChange({ conditions: propres.filter((_, j) => j !== i), inclure_bloques: inclureBloques });
    setEdition(null);
  };

  const groupes = grouperChamps(champs);
  const champEdite = edition ? index.get(edition.champ) : undefined;
  const contexte: Filtre = { conditions: [...heritees, ...propres.filter((_, i) => i !== edition?.index)], inclure_bloques: inclureBloques };

  return (
    <div className="pop" ref={ref} role="dialog" aria-label="Filtres" data-atlas-filtres>
      {lectureSeule && <p className="callout">Lecture seule sur cet espace : les filtres ne s&apos;enregistrent pas.</p>}
      {groupes.map((g) => {
        const miens = propres.map((c, i) => ({ c, i })).filter(({ c }) => index.get(c.champ)?.groupe === g.groupe);
        const herites = heritees.filter((c) => index.get(c.champ)?.groupe === g.groupe);
        return (
          <div className="prow" key={g.groupe}>
            <span>{g.groupe}</span>
            <div className="opts">
              {herites.map((c, i) => (
                <span key={`h${i}`} className="opt lock" title="Hérité du marché : se modifie sur le marché">
                  {phraseCondition(c, index)}
                </span>
              ))}
              {miens.map(({ c, i }) => (
                <button
                  key={`c${i}`}
                  type="button"
                  className="opt on"
                  aria-pressed={edition?.index === i}
                  title="Modifier ou retirer"
                  onClick={() => commencer(c.champ, i)}
                  disabled={lectureSeule}
                >
                  {phraseCondition(c, index)}
                </button>
              ))}
              {!lectureSeule && (
                <select
                  aria-label={`Ajouter un filtre : ${g.groupe}`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) commencer(e.target.value, null);
                  }}
                >
                  <option value="">+ ajouter</option>
                  {g.champs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.libelle}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
      <div className="prow">
        <span>Bloquées</span>
        <label className="ck">
          <input
            type="checkbox"
            checked={inclureBloques}
            disabled={lectureSeule}
            onChange={(e) => onChange({ conditions: propres, inclure_bloques: e.target.checked })}
          />
          Inclure les entreprises écartées par ODH (cessées, sans contact…)
        </label>
      </div>

      {edition && champEdite && (
        <div className="edit" aria-label={`Filtre ${champEdite.libelle}`} role="group">
          <div className="row">
            <b>{champEdite.libelle}</b>
            {champEdite.operateurs.length > 1 && (
              <select
                className="fld"
                aria-label="Opérateur"
                value={edition.op}
                onChange={(e) => setEdition({ ...edition, op: e.target.value })}
              >
                {champEdite.operateurs.map((op) => (
                  <option key={op} value={op}>
                    {libelleOperateur(op, champEdite.type)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <ValeurCondition champ={champEdite} op={edition.op} saisie={edition.saisie} contexte={contexte} onChange={(saisie) => setEdition({ ...edition, saisie })} onValider={appliquer} />
          {msg && (
            <p className="msg" role="alert">
              {msg}
            </p>
          )}
          <div className="row end">
            {edition.index !== null && (
              <button type="button" className="btn ghost sm" onClick={() => retirer(edition.index as number)} style={{ marginRight: "auto" }}>
                Retirer
              </button>
            )}
            <button type="button" className="btn sm" onClick={() => setEdition(null)}>
              Annuler
            </button>
            <button type="button" className="btn pri sm" onClick={appliquer}>
              Appliquer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ValeurCondition({
  champ,
  op,
  saisie,
  contexte,
  onChange,
  onValider,
}: {
  champ: ChampInfo;
  op: string;
  saisie: Saisie;
  contexte: Filtre;
  onChange: (s: Saisie) => void;
  onValider: () => void;
}) {
  const [brut, setBrut] = useState("");
  const [suggestions, setSuggestions] = useState<RepartitionMarche["valeurs"] | null>(null);
  const set = (patch: Partial<Saisie>) => onChange({ ...saisie, ...patch });
  const suggere = champ.type === "liste" && champ.repartition && op !== "renseigne";
  const cle = JSON.stringify(contexte);

  useEffect(() => {
    if (!suggere) return;
    const ctl = new AbortController();
    appeler<RepartitionMarche>("repartir_marche", { filtre: JSON.parse(cle) as Filtre, champ: champ.id, limite: 24 }, ctl.signal)
      .then((r) => setSuggestions(r.valeurs))
      .catch((e) => !estAnnulation(e) && setSuggestions([]));
    return () => ctl.abort();
  }, [suggere, champ.id, cle]);

  const entree = (e: ClavierReact) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onValider();
    }
  };

  if (op === "renseigne" || champ.type === "oui_non") {
    const oui = op === "renseigne" ? "Renseigné" : "Oui";
    const non = op === "renseigne" ? "Non renseigné" : "Non";
    return (
      <div className="opts" role="radiogroup" aria-label="Valeur">
        <button type="button" role="radio" aria-checked={saisie.oui} className={saisie.oui ? "opt on" : "opt"} onClick={() => set({ oui: true })}>
          {oui}
        </button>
        <button type="button" role="radio" aria-checked={!saisie.oui} className={!saisie.oui ? "opt on" : "opt"} onClick={() => set({ oui: false })}>
          {non}
        </button>
      </div>
    );
  }
  if (champ.type === "liste") {
    const bascule = (v: string) => set({ liste: saisie.liste.includes(v) ? saisie.liste.filter((x) => x !== v) : [...saisie.liste, v] });
    const proposes = new Set((suggestions ?? []).map((s) => s.cle));
    return (
      <>
        <div className="opts" aria-label="Valeurs choisies">
          {saisie.liste
            .filter((v) => !proposes.has(v))
            .map((v) => (
              <button key={v} type="button" className="opt on" onClick={() => bascule(v)} aria-label={`Retirer ${v}`}>
                {v} ×
              </button>
            ))}
          {(suggestions ?? []).map((s) => (
            <button key={s.cle} type="button" className={saisie.liste.includes(s.cle) ? "opt on" : "opt"} aria-pressed={saisie.liste.includes(s.cle)} onClick={() => bascule(s.cle)}>
              {s.cle} <span className="num" style={{ opacity: 0.6 }}>{s.nombre.toLocaleString("fr-FR")}</span>
            </button>
          ))}
          {suggere && suggestions === null && <span className="hint">Valeurs en cours de chargement…</span>}
        </div>
        <input
          className="fld"
          placeholder="Autre valeur, puis Entrée (virgules acceptées)"
          aria-label={`Valeurs pour ${champ.libelle}`}
          value={brut}
          onChange={(e) => setBrut(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (brut.trim()) {
                set({ liste: ajouterValeurs(saisie.liste, brut) });
                setBrut("");
              } else onValider();
            }
          }}
          onBlur={() => {
            if (brut.trim()) {
              set({ liste: ajouterValeurs(saisie.liste, brut) });
              setBrut("");
            }
          }}
        />
      </>
    );
  }
  if (champ.type === "nombre") {
    const un = (cle: "min" | "max", label: string) => (
      <input key={cle} className="fld n" inputMode="decimal" placeholder={label} aria-label={`${champ.libelle} ${label}`} value={saisie[cle]} onChange={(e) => set({ [cle]: e.target.value })} onKeyDown={entree} />
    );
    return op === "entre" ? (
      <div className="row">
        {un("min", "minimum")}
        <span className="hint">et</span>
        {un("max", "maximum")}
      </div>
    ) : (
      <div className="row">{un(op === "max" ? "max" : "min", "nombre")}</div>
    );
  }
  if (champ.type === "date") {
    return (
      <div className="row">
        <input type="date" className="fld" aria-label={`${champ.libelle} : date`} value={saisie.texte} onChange={(e) => set({ texte: e.target.value })} onKeyDown={entree} />
      </div>
    );
  }
  return (
    <div className="row">
      <input className="fld w" placeholder="Texte" aria-label={`${champ.libelle} : texte`} value={saisie.texte} onChange={(e) => set({ texte: e.target.value })} onKeyDown={entree} autoFocus />
    </div>
  );
}
