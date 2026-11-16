"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { DEPARTMENT_NAMES, DEPARTMENT_PATHS } from "@/components/dashboard/france-map-data";

import { appeler, contoursCommunes, estAnnulation, texteErreur } from "./api";
import { bornes, cadrageCommune, cadrageDescente, chaleur, interpolerCadre, placerPoints, rang, valeurCommune, valeursCarte, VUE_FRANCE, type Mesure } from "./carte-logique";
import { avecCondition } from "./flux";
import { Chargement } from "./icones";
import { formaterNombre } from "./logique";
import type { AnalyseMarche, Boite, ChampInfo, CommuneComptee, CommuneGeo, CommunesMarche, Filtre, PointCarte, RepartitionMarche } from "./types";

const CODES = Object.keys(DEPARTMENT_PATHS);
const OFF = "#f1f5f9";
const OFF_LINE = "#d5dde7";
/** Communes listées avant « Voir toutes ». */
const COMMUNES_VISIBLES = 12;

type Props = {
  /** « marche » : toutes les entreprises (cube d'ODH) ; « prospection » : les fiches prospectables. */
  base?: "marche" | "prospection";
  filtre: Filtre;
  index: ReadonlyMap<string, ChampInfo>;
  descente: string | null;
  onDescente: (code: string | null) => void;
  /** Commune regardée dans le département (null : tout le département). */
  commune: CommuneComptee | null;
  onCommune: (c: CommuneComptee | null) => void;
  onFiche: (siren: string, nom: string) => void;
};

/** Mesures de la base marché : sur toutes les entreprises, la part qu'on peut contacter. */
const MESURES_MARCHE: { id: Mesure; libelle: string; champ: string }[] = [
  { id: "nombre", libelle: "Entreprises", champ: "" },
  { id: "contactable", libelle: "Contactables", champ: "" },
  { id: "email_envoyable", libelle: "Email envoyable", champ: "" },
];

const MESURES: { id: Mesure; libelle: string; champ: string }[] = [
  { id: "nombre", libelle: "Entreprises", champ: "" },
  { id: "sans_site", libelle: "Sans site", champ: "site" },
  { id: "avec_email", libelle: "Avec email", champ: "email" },
];

function partieDe(m: Mesure, f: Filtre): Filtre | null {
  if (m === "sans_site") return avecCondition(f, { champ: "site", op: "renseigne", valeur: false });
  if (m === "avec_email") return avecCondition(f, { champ: "email", op: "renseigne", valeur: true });
  return null;
}

export function Carte({ base: source = "prospection", filtre, index, descente, onDescente, commune, onCommune, onFiche }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cadre = useRef<number[]>([...VUE_FRANCE]);
  const anim = useRef(0);
  const [mesure, setMesure] = useState<Mesure>("nombre");
  const [base, setBase] = useState<RepartitionMarche["valeurs"] | null>(null);
  const [partie, setPartie] = useState<RepartitionMarche["valeurs"] | null>(null);
  const [points, setPoints] = useState<PointCarte[] | null>(null);
  const [contours, setContours] = useState<CommuneGeo[] | null>(null);
  const [comptes, setComptes] = useState<CommunesMarche | null>(null);
  const [toutes, setToutes] = useState(false);
  const [boite, setBoite] = useState<Boite | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [bulle, setBulle] = useState<{ x: number; y: number; texte: string } | null>(null);
  const cle = JSON.stringify(filtre);
  const mesures = source === "marche" ? MESURES_MARCHE : MESURES.filter((m) => !m.champ || index.has(m.champ));
  // Changer de base (marché ↔ cible) remet une mesure qui existe dans la nouvelle base.
  useEffect(() => {
    if (!mesures.some((m) => m.id === mesure)) setMesure("nombre");
  }, [mesures, mesure]);

  // Répartition par département (et sous-population de la mesure).
  useEffect(() => {
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    setChargement(true);
    setErreur(null);
    if (source === "marche") {
      // Une requête au cube donne, par département, le total et les parts contactables.
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "departement", limite: 200 }, ctl.signal)
        .then((r) => {
          const lignes = r.lignes.filter((l) => l.cle && l.cle !== "99");
          setBase(lignes.map((l) => ({ cle: l.cle, nombre: l.entreprises })));
          setPartie(mesure === "nombre" ? null : lignes.map((l) => ({ cle: l.cle, nombre: mesure === "contactable" ? l.prospectables : l.email_envoyable })));
        })
        .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
        .finally(() => !ctl.signal.aborted && setChargement(false));
      return () => ctl.abort();
    }
    const p = partieDe(mesure, f);
    Promise.all([
      appeler<RepartitionMarche>("repartir_marche", { filtre: f, champ: "departement", limite: 120 }, ctl.signal),
      p ? appeler<RepartitionMarche>("repartir_marche", { filtre: p, champ: "departement", limite: 120 }, ctl.signal) : Promise.resolve(null),
    ])
      .then(([b, q]) => {
        setBase(b.valeurs);
        setPartie(q ? q.valeurs : null);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
      .finally(() => !ctl.signal.aborted && setChargement(false));
    return () => ctl.abort();
  }, [cle, mesure, source]);

  // Descente : contours et comptes des communes du département.
  useEffect(() => {
    setContours(null);
    setComptes(null);
    setToutes(false);
    if (!descente) return;
    const ctl = new AbortController();
    contoursCommunes(descente, ctl.signal)
      .then(setContours)
      .catch((e) => {
        if (estAnnulation(e)) return;
        setContours([]); // la carte reste utilisable sans contours : liste et points
        setErreur(texteErreur(e));
      });
    appeler<CommunesMarche>("repartir_communes", { filtre: JSON.parse(cle) as Filtre, departement: descente, base: source }, ctl.signal)
      .then(setComptes)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, descente, source]);

  // Points : les fiches prospectables du département, ou de la commune regardée.
  const codeCommune = commune?.code ?? null;
  useEffect(() => {
    setPoints(null);
    if (!descente) return;
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    const ici = codeCommune && /^\d[\dAB]\d{3}$/.test(codeCommune) ? avecCondition(f, { champ: "commune_insee", op: "dans", valeur: [codeCommune] }) : f;
    appeler<{ points: PointCarte[] }>("points_carte", { filtre: ici, departement: descente, limite: codeCommune ? 200 : 400 }, ctl.signal)
      .then((p) => setPoints(p.points))
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, descente, codeCommune]);

  // Les chiffres de la commune regardée suivent le filtre (le parent en tire ses chiffres clés).
  useEffect(() => {
    if (!commune || !comptes) return;
    const frais = comptes.communes.find((c) => c.code === commune.code) ?? { ...commune, mesures: { entreprises: 0 } };
    if (JSON.stringify(frais.mesures) !== JSON.stringify(commune.mesures)) onCommune(frais);
  }, [comptes, commune, onCommune]);

  const contourCommune = useMemo(() => (codeCommune && contours ? (contours.find((c) => c.code === codeCommune) ?? null) : null), [codeCommune, contours]);

  // Zoom animé : France, département, ou commune.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let vers: number[] = [...VUE_FRANCE];
    let b: Boite | null = null;
    if (descente) {
      const chemin = svg.querySelector<SVGPathElement>(`path[data-c="${descente}"]`);
      if (chemin) {
        const bb = chemin.getBBox();
        b = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
        vers = contourCommune
          ? cadrageCommune({ x: contourCommune.x, y: contourCommune.y, width: contourCommune.w, height: contourCommune.h }, Math.max(b.width, b.height) / 10)
          : cadrageDescente(b);
      }
    }
    setBoite(b);
    cancelAnimationFrame(anim.current);
    const de = [...cadre.current];
    const t0 = performance.now();
    const duree = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520;
    const pas = (t: number) => {
      const k = duree ? Math.min(1, (t - t0) / duree) : 1;
      cadre.current = interpolerCadre(de, vers, k);
      svg.setAttribute("viewBox", cadre.current.join(" "));
      if (k < 1) anim.current = requestAnimationFrame(pas);
    };
    anim.current = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(anim.current);
  }, [descente, contourCommune]);

  const valeurs = useMemo(() => (base ? valeursCarte(base, mesure === "nombre" ? null : (partie ?? [])) : new Map<string, number>()), [base, partie, mesure]);
  const effectifs = useMemo(() => (base ? valeursCarte(base, null) : new Map<string, number>()), [base]);
  const b = bornes(valeurs.values());
  const enPct = mesure !== "nombre";
  const fv = (v: number) => (enPct ? `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : formaterNombre(Math.round(v)));
  const unite =
    mesure === "nombre" ? "entreprises" : mesure === "sans_site" ? "sans site web" : mesure === "contactable" ? "contactables" : mesure === "email_envoyable" ? "email envoyable" : "avec email";
  const nom = (c: string) => DEPARTMENT_NAMES[c] ?? c;

  // Communes : valeur de la mesure, échelle logarithmique pour les nombres (la préfecture écraserait tout).
  const parCode = useMemo(() => new Map((comptes?.communes ?? []).map((c) => [c.code, c])), [comptes]);
  const valeursCommunes = useMemo(() => new Map((comptes?.communes ?? []).map((c) => [c.code, valeurCommune(mesure, c.mesures)])), [comptes, mesure]);
  const echelle = (v: number) => (enPct ? v : Math.log1p(v));
  const bc = bornes([...valeursCommunes.values()].map(echelle));
  const classees = useMemo(
    () => [...(comptes?.communes ?? [])].sort((x, y) => (valeursCommunes.get(y.code) ?? 0) - (valeursCommunes.get(x.code) ?? 0) || (y.mesures.entreprises ?? 0) - (x.mesures.entreprises ?? 0)),
    [comptes, valeursCommunes],
  );
  // Les six communes les plus fournies ont leur nom sur la carte du département.
  const etiquettes = useMemo(() => {
    if (!contours || commune) return [];
    const geo = new Map(contours.map((c) => [c.code, c]));
    return [...(comptes?.communes ?? [])]
      .slice(0, 6)
      .map((c) => geo.get(c.code))
      .filter((g): g is CommuneGeo => !!g);
  }, [contours, comptes, commune]);

  const projetes = useMemo(() => (points ? placerPoints(points) : []), [points]);
  const taille = boite ? Math.max(boite.width, boite.height) : 100;
  const zone = contourCommune ? Math.max(contourCommune.w, contourCommune.h, taille / 10) : taille;
  const rayon = contourCommune ? zone / 70 : zone / 110;

  const survol = (e: MouseEvent<SVGSVGElement>) => {
    const el = e.target as Element;
    const wrap = svgRef.current?.parentElement?.getBoundingClientRect();
    if (!wrap) return;
    const pos = { x: e.clientX - wrap.left, y: e.clientY - wrap.top };
    const dot = el.closest<SVGCircleElement>("circle[data-s]");
    if (dot) {
      const p = projetes.find((x) => x.siren === dot.dataset.s);
      if (p) return setBulle({ ...pos, texte: `${p.nom} · ${p.commune}` });
    }
    const com = el.closest<SVGPathElement>("path[data-m]");
    if (com) {
      const g = contours?.find((x) => x.code === com.dataset.m);
      const v = valeursCommunes.get(com.dataset.m ?? "");
      if (g) return setBulle({ ...pos, texte: `${g.nom} · ${v === undefined ? `aucune entreprise` : `${fv(v)} ${unite}`}` });
    }
    const chemin = el.closest<SVGPathElement>("path[data-c]");
    if (chemin && chemin.dataset.c !== descente) {
      const c = chemin.dataset.c ?? "";
      const v = valeurs.get(c);
      return setBulle({ ...pos, texte: `${nom(c)} · ${v === undefined ? "hors zone" : `${fv(v)} ${unite}`}` });
    }
    setBulle(null);
  };

  const ouvrirCommune = (code: string) => {
    const c = parCode.get(code);
    const g = contours?.find((x) => x.code === code);
    onCommune(c ?? { code, nom: g?.nom ?? code, mesures: { entreprises: 0 } });
  };

  const clic = (e: MouseEvent<SVGSVGElement>) => {
    const el = e.target as Element;
    const dot = el.closest<SVGCircleElement>("circle[data-s]");
    if (dot) {
      const p = projetes.find((x) => x.siren === dot.dataset.s);
      if (p) onFiche(p.siren, p.nom);
      return;
    }
    const m = el.closest<SVGPathElement>("path[data-m]")?.dataset.m;
    if (m) return m === codeCommune ? onCommune(null) : ouvrirCommune(m);
    const c = el.closest<SVGPathElement>("path[data-c]")?.dataset.c;
    if (c === descente && commune) return onCommune(null);
    if (c && c !== descente && effectifs.has(c)) onDescente(c);
  };

  const top = [...valeurs].sort((x, y) => y[1] - x[1]).slice(0, 7);
  const nonRapprochees = comptes?.non_rapprochees.entreprises ?? 0;
  const ligneCommune = (c: CommuneComptee) => (
    <button key={c.code} type="button" onClick={() => ouvrirCommune(c.code)} aria-current={c.code === codeCommune ? "true" : undefined}>
      <span>{c.nom}</span>
      <span className="num">{fv(valeursCommunes.get(c.code) ?? 0)}</span>
    </button>
  );

  return (
    <div className="mapgrid">
      <div className="mapwrap" aria-busy={chargement}>
        <svg
          ref={svgRef}
          viewBox={VUE_FRANCE.join(" ")}
          role="img"
          aria-label={
            commune
              ? `Carte de la commune ${commune.nom} et de ses entreprises`
              : descente
                ? `Carte du département ${nom(descente)}, communes colorées selon la mesure choisie`
                : "Carte des départements, colorée selon la mesure choisie"
          }
          onMouseMove={survol}
          onMouseLeave={() => setBulle(null)}
          onClick={clic}
        >
          <g>
            {CODES.map((c) => {
              const v = valeurs.get(c);
              const on = effectifs.has(c);
              const focus = descente === c;
              const stroke = focus ? "hsl(217 60% 55%)" : on ? "#94a3b8" : OFF_LINE;
              const fill = focus ? "hsl(217 60% 97%)" : on && v !== undefined && b ? chaleur(rang(v, b.min, b.max)) : OFF;
              return (
                <path
                  key={c}
                  data-c={c}
                  className={on ? "dept" : "dept hz"}
                  d={DEPARTMENT_PATHS[c]}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={descente ? (focus ? 1.6 : 0.6) : on ? 0.6 : 0.4}
                  vectorEffect={descente ? "non-scaling-stroke" : undefined}
                  opacity={descente && !focus ? 0.35 : 1}
                />
              );
            })}
          </g>
          {descente && contours && (
            <g>
              {contours.map((g) => {
                const v = valeursCommunes.get(g.code);
                const focus = g.code === codeCommune;
                const fill = v === undefined || !bc ? OFF : chaleur(rang(echelle(v), bc.min, bc.max));
                return (
                  <path
                    key={g.code}
                    data-m={g.code}
                    className="commune"
                    d={g.d}
                    fill={fill}
                    stroke={focus ? "hsl(217 90% 45%)" : "#fff"}
                    strokeWidth={focus ? 2 : 0.6}
                    vectorEffect="non-scaling-stroke"
                    opacity={codeCommune && !focus ? 0.45 : 1}
                  >
                    <title>{g.nom}</title>
                  </path>
                );
              })}
              {contourCommune && (
                <path d={contourCommune.d} fill="none" stroke="hsl(217 90% 45%)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              )}
              {etiquettes.map((g) => (
                <text key={g.code} className="etiq" x={g.x + g.w / 2} y={g.y + g.h / 2} fontSize={taille / 45} textAnchor="middle" dominantBaseline="middle">
                  {g.nom}
                </text>
              ))}
            </g>
          )}
          <g>
            {projetes.map((p) => (
              <circle
                key={p.siren}
                className="dot"
                data-s={p.siren}
                cx={p.x.toFixed(3)}
                cy={p.y.toFixed(3)}
                r={rayon.toFixed(3)}
                fill={p.email ? "hsl(217 90% 55%)" : "#64748b"}
                fillOpacity={0.85}
                stroke="#fff"
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        </svg>
        {bulle && (
          <div className="tip" style={{ left: bulle.x, top: bulle.y }}>
            {bulle.texte}
          </div>
        )}
      </div>

      <div className="side">
        {erreur && <p className="err" role="alert">{erreur}</p>}
        {mesures.length > 1 && (
          <div>
            <h4>Mesure</h4>
            <div className="seg3" role="group" aria-label="Mesure de la carte">
              {mesures.map((m) => (
                <button key={m.id} type="button" className={mesure === m.id ? "on" : undefined} aria-pressed={mesure === m.id} onClick={() => setMesure(m.id)}>
                  {m.libelle}
                </button>
              ))}
            </div>
          </div>
        )}
        {commune ? (
          <>
            <div>
              <h4>{commune.nom}</h4>
              <div className="rows">
                <div>
                  <span>{source === "marche" ? "Entreprises du marché" : "Entreprises de la cible"}</span>
                  <span className="num">{formaterNombre(commune.mesures.entreprises ?? 0)}</span>
                </div>
                {commune.mesures.contactables !== undefined && source === "marche" && (
                  <div>
                    <span>Contactables</span>
                    <span className="num">{formaterNombre(commune.mesures.contactables)}</span>
                  </div>
                )}
                {commune.mesures.email_envoyable !== undefined && (
                  <div>
                    <span>Email envoyable</span>
                    <span className="num">{formaterNombre(commune.mesures.email_envoyable)}</span>
                  </div>
                )}
                {commune.mesures.telephone_envoyable !== undefined && (
                  <div>
                    <span>Téléphone utilisable</span>
                    <span className="num">{formaterNombre(commune.mesures.telephone_envoyable)}</span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h4>Entreprises contactables</h4>
              {points === null ? (
                <Chargement />
              ) : points.length === 0 ? (
                <p className="hint">Aucune fiche contactable géolocalisée dans cette commune.</p>
              ) : (
                <div className="rows liste-longue">
                  {points.map((p) => (
                    <button key={p.siren} type="button" onClick={() => onFiche(p.siren, p.nom)}>
                      <span>{p.nom}</span>
                      <span>{p.email ? "email" : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="hint">
              <button type="button" className="lnk" onClick={() => onCommune(null)}>
                Revenir à {nom(descente ?? "")}
              </button>
              {" · "}
              <span style={{ color: "var(--blue)" }}>●</span> avec email, <span style={{ color: "#64748b" }}>●</span> sans. Cliquez un point pour ouvrir la fiche.
            </p>
          </>
        ) : descente ? (
          <>
            <div>
              <h4>Communes</h4>
              {comptes === null ? (
                <Chargement />
              ) : classees.length === 0 ? (
                <p className="hint">Aucune entreprise dans ce département.</p>
              ) : (
                <>
                  <div className={toutes ? "rows liste-longue" : "rows"}>{(toutes ? classees : classees.slice(0, COMMUNES_VISIBLES)).map(ligneCommune)}</div>
                  {classees.length > COMMUNES_VISIBLES && (
                    <button type="button" className="lnk" onClick={() => setToutes((t) => !t)}>
                      {toutes ? "Réduire" : `Voir les ${formaterNombre(classees.length)} communes`}
                    </button>
                  )}
                </>
              )}
            </div>
            <div>
              <h4>Les mieux notées</h4>
              {points === null ? (
                <Chargement />
              ) : points.length === 0 ? (
                <p className="hint">Aucune fiche contactable géolocalisée.</p>
              ) : (
                <div className="rows">
                  {points.slice(0, 6).map((p) => (
                    <button key={p.siren} type="button" onClick={() => onFiche(p.siren, p.nom)}>
                      <span>{p.nom}</span>
                      <span>{p.commune}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="hint">
              Cliquez une commune pour y descendre.{" "}
              {comptes?.repli ? "Marché trop large pour la base complète : les communes comptent les fiches contactables. " : ""}
              {nonRapprochees > 0 ? `${formaterNombre(nonRapprochees)} entreprises sans commune reconnue. ` : ""}
              Points : les fiches contactables, <span style={{ color: "var(--blue)" }}>●</span> avec email.
            </p>
          </>
        ) : (
          <>
            <div>
              <div className="ramp" />
              <div className="ends num">
                <span>{b ? fv(b.min) : "–"}</span>
                <span>{b ? fv(b.max) : "–"}</span>
              </div>
            </div>
            <div>
              <h4>{enPct ? "Départements où la part est la plus forte" : "Départements en tête"}</h4>
              {!base && chargement ? (
                <Chargement />
              ) : top.length === 0 ? (
                <p className="hint">Aucune entreprise pour ces filtres.</p>
              ) : (
                <div className="rows">
                  {top.map(([c, v]) => (
                    <button key={c} type="button" onClick={() => onDescente(c)}>
                      <span>{nom(c)}</span>
                      <span className="num">{fv(v)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="hint">Cliquez un département pour y descendre.</p>
          </>
        )}
      </div>
    </div>
  );
}
