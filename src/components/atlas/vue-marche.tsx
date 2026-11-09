"use client";

import { useEffect, useState } from "react";

import { appeler, estAnnulation, texteErreur } from "./api";
import { Chargement, Icone } from "./icones";
import { formaterNombre, phraseCondition } from "./logique";
import { AXES_MARCHE, COLONNES_MARCHE, STATUTS_MARCHE, etiquetteLigne, part, type StatutMarche } from "./marche";
import type { AnalyseMarche, AxeMarche, ChampInfo, Filtre } from "./types";

/**
 * Taille du marché entier (cube d'ODH) pour le filtre courant : l'étape « analyse du marché ».
 * Les autres vues ne montrent que les fiches prospectables ; celle-ci compte toutes les entreprises.
 */
export function VueMarche({ filtre, index }: { filtre: Filtre; index: ReadonlyMap<string, ChampInfo> }) {
  const [axe, setAxe] = useState<AxeMarche>(() => (filtre.conditions.some((c) => c.champ === "naf" && c.op === "dans") ? "naf" : "departement"));
  const [statut, setStatut] = useState<StatutMarche>("actif");
  const [donnees, setDonnees] = useState<AnalyseMarche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const cle = JSON.stringify(filtre);

  useEffect(() => {
    const ctl = new AbortController();
    setErreur(null);
    setDonnees(null);
    appeler<AnalyseMarche>("analyser_marche", { filtre: JSON.parse(cle) as Filtre, axe, statut, limite: 200 }, ctl.signal)
      .then(setDonnees)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, axe, statut, essai]);

  const t = donnees?.total;
  return (
    <div className="marche">
      <div className="tools">
        <label htmlFor="atlas-axe-marche">Répartir par</label>
        <select id="atlas-axe-marche" className="sel" value={axe} onChange={(e) => setAxe(e.target.value as AxeMarche)}>
          {AXES_MARCHE.map((a) => (
            <option key={a.id} value={a.id}>
              {a.libelle}
            </option>
          ))}
        </select>
        <span className="seg3" role="radiogroup" aria-label="Statut des entreprises">
          {STATUTS_MARCHE.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={statut === s.id} className={statut === s.id ? "on" : undefined} onClick={() => setStatut(s.id)}>
              {s.libelle}
            </button>
          ))}
        </span>
      </div>

      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          <span>{erreur}</span>
          <button type="button" onClick={() => setEssai((n) => n + 1)}>
            Réessayer
          </button>
        </p>
      )}
      {!donnees && !erreur && <Chargement />}

      {donnees && t && (
        <>
          <div className="kpis marche-kpis" aria-live="polite">
            <div className="kpi">
              <b className="num">{formaterNombre(t.entreprises)}</b>
              <span>entreprises sur le marché</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.email_connu)}</b>
              <span>email connu · {part(t.email_connu, t.entreprises)}</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.email_envoyable)}</b>
              <span>email envoyable · {part(t.email_envoyable, t.entreprises)}</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.un_canal_connu)}</b>
              <span>au moins un canal connu</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.prospectables)}</b>
              <span>prospectables dans Atlas</span>
            </div>
          </div>

          {donnees.conditions_ignorees.length > 0 && (
            <p className="hint">
              Le marché se compte sur l&apos;activité, le lieu, la forme, l&apos;effectif et l&apos;année de création. Non pris en compte ici :{" "}
              {donnees.conditions_ignorees.map((c) => phraseCondition(c, index)).join(" ; ")}.
            </p>
          )}

          {donnees.lignes.length === 0 ? (
            <p className="empty">Aucune entreprise pour ces critères.</p>
          ) : (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{AXES_MARCHE.find((a) => a.id === donnees.axe)?.libelle ?? "Valeur"}</th>
                    {COLONNES_MARCHE.map((c) => (
                      <th key={c.id} scope="col" className="num" title={c.aide}>
                        {c.libelle}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {donnees.lignes.map((l) => (
                    <tr key={l.cle} className="statique">
                      <td title={etiquetteLigne(l.cle, l.libelle)}>{etiquetteLigne(l.cle, l.libelle)}</td>
                      {COLONNES_MARCHE.map((c) => (
                        <td key={c.id} className="num">
                          {formaterNombre(l[c.id])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="hint">
            Source : cube de marché ODH (INSEE SIRENE et contacts trouvés par ODH)
            {donnees.provenance ? `, calculé le ${donnees.provenance.calcule_le.slice(0, 10).split("-").reverse().join("/")}` : ""}. « Connu » : contact trouvé,
            même écarté ensuite ; « envoyable » : ce qu&apos;on peut utiliser pour un envoi.
          </p>
        </>
      )}
    </div>
  );
}
