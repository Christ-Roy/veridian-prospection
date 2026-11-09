"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { DEPARTMENT_NAMES, DEPARTMENT_PATHS } from "@/components/dashboard/france-map-data";

import { appeler, estAnnulation, texteErreur } from "./api";
import { bornes, cadrageDescente, chaleur, interpolerCadre, projeterPoints, rang, valeursCarte, VUE_FRANCE, type Mesure } from "./carte-logique";
import { avecCondition, avecDepartement } from "./flux";
import { Chargement } from "./icones";
import { formaterNombre } from "./logique";
import type { AnalyseMarche, Boite, ChampInfo, Filtre, PointCarte, RepartitionMarche } from "./types";

const CODES = Object.keys(DEPARTMENT_PATHS);
const OFF = "#f1f5f9";
const OFF_LINE = "#d5dde7";

type Props = {
  /** « marche » : toutes les entreprises (cube d'ODH) ; « prospection » : les fiches prospectables. */
  base?: "marche" | "prospection";
  filtre: Filtre;
  index: ReadonlyMap<string, ChampInfo>;
  descente: string | null;
  onDescente: (code: string | null) => void;
  onFiche: (siren: string, nom: string) => void;
};

/** Mesures de la base marché : sur toutes les entreprises, la part qu'on peut contacter. */
const MESURES_MARCHE: { id: Mesure; libelle: string; champ: string }[] = [
  { id: "nombre", libelle: "Entreprises", champ: "" },
  { id: "contactable", libelle: "Part contactable", champ: "" },
  { id: "email_envoyable", libelle: "Email envoyable", champ: "" },
];

const MESURES: { id: Mesure; libelle: string; champ: string }[] = [
  { id: "nombre", libelle: "Nombre", champ: "" },
  { id: "sans_site", libelle: "Sans site", champ: "site" },
  { id: "avec_email", libelle: "Avec email", champ: "email" },
];

function partieDe(m: Mesure, f: Filtre): Filtre | null {
  if (m === "sans_site") return avecCondition(f, { champ: "site", op: "renseigne", valeur: false });
  if (m === "avec_email") return avecCondition(f, { champ: "email", op: "renseigne", valeur: true });
  return null;
}

export function Carte({ base: source = "prospection", filtre, index, descente, onDescente, onFiche }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cadre = useRef<number[]>([...VUE_FRANCE]);
  const anim = useRef(0);
  const [mesure, setMesure] = useState<Mesure>("nombre");
  const [base, setBase] = useState<RepartitionMarche["valeurs"] | null>(null);
  const [partie, setPartie] = useState<RepartitionMarche["valeurs"] | null>(null);
  const [points, setPoints] = useState<PointCarte[] | null>(null);
  const [communes, setCommunes] = useState<RepartitionMarche["valeurs"] | null>(null);
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

  // Descente : points des entreprises et communes du département.
  useEffect(() => {
    setPoints(null);
    setCommunes(null);
    if (!descente) return;
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    Promise.all([
      appeler<{ points: PointCarte[] }>("points_carte", { filtre: f, departement: descente, limite: 400 }, ctl.signal),
      index.has("commune") ? appeler<RepartitionMarche>("repartir_marche", { filtre: avecDepartement(f, descente), champ: "commune", limite: 10 }, ctl.signal) : Promise.resolve(null),
    ])
      .then(([p, c]) => {
        setPoints(p.points);
        setCommunes(c ? c.valeurs : []);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, descente, index]);

  // Zoom animé sur le chemin du département (ou retour à la France).
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
        vers = cadrageDescente(b);
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
  }, [descente]);

  const valeurs = useMemo(() => (base ? valeursCarte(base, mesure === "nombre" ? null : (partie ?? [])) : new Map<string, number>()), [base, partie, mesure]);
  const effectifs = useMemo(() => (base ? valeursCarte(base, null) : new Map<string, number>()), [base]);
  const b = bornes(valeurs.values());
  const enPct = mesure !== "nombre";
  const fv = (v: number) => (enPct ? `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : formaterNombre(Math.round(v)));
  const unite =
    mesure === "nombre" ? "entreprises" : mesure === "sans_site" ? "sans site web" : mesure === "contactable" ? "contactables" : mesure === "email_envoyable" ? "email envoyable" : "avec email";
  const nom = (c: string) => DEPARTMENT_NAMES[c] ?? c;
  const projetes = useMemo(() => (points && boite ? projeterPoints(points, boite) : []), [points, boite]);
  const rayon = boite ? Math.max(boite.width, boite.height) / 95 : 1;

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
    const chemin = el.closest<SVGPathElement>("path[data-c]");
    if (chemin && !descente) {
      const c = chemin.dataset.c ?? "";
      const v = valeurs.get(c);
      return setBulle({ ...pos, texte: `${nom(c)} · ${v === undefined ? "hors zone" : `${fv(v)} ${unite}`}` });
    }
    setBulle(null);
  };

  const clic = (e: MouseEvent<SVGSVGElement>) => {
    const el = e.target as Element;
    const dot = el.closest<SVGCircleElement>("circle[data-s]");
    if (dot) {
      const p = projetes.find((x) => x.siren === dot.dataset.s);
      if (p) onFiche(p.siren, p.nom);
      return;
    }
    const c = el.closest<SVGPathElement>("path[data-c]")?.dataset.c;
    if (c && c !== descente && effectifs.has(c)) onDescente(c);
  };

  const top = [...valeurs].sort((x, y) => y[1] - x[1]).slice(0, 7);
  const totalDescente = descente ? (effectifs.get(descente) ?? 0) : 0;

  return (
    <div className="mapgrid">
      <div className="mapwrap" aria-busy={chargement}>
        <svg
          ref={svgRef}
          viewBox={VUE_FRANCE.join(" ")}
          role="img"
          aria-label={descente ? `Carte du département ${nom(descente)} et de ses entreprises` : "Carte des départements, colorée selon la mesure choisie"}
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
              const largeur = descente ? (focus ? 0.6 : 0.25) : on ? 0.6 : 0.4;
              const fill = focus ? "hsl(217 60% 97%)" : on && v !== undefined && b ? chaleur(rang(v, b.min, b.max)) : OFF;
              return (
                <path
                  key={c}
                  data-c={c}
                  className={on ? "dept" : "dept hz"}
                  d={DEPARTMENT_PATHS[c]}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={largeur}
                  opacity={descente && !focus ? 0.35 : 1}
                />
              );
            })}
          </g>
          <g>
            {projetes.map((p) => (
              <circle
                key={p.siren}
                className="dot"
                data-s={p.siren}
                cx={p.x.toFixed(2)}
                cy={p.y.toFixed(2)}
                r={rayon.toFixed(2)}
                fill={p.email ? "hsl(217 90% 55%)" : "#64748b"}
                fillOpacity={0.8}
                stroke="#fff"
                strokeWidth={(rayon / 3).toFixed(2)}
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
        {descente ? (
          <>
            <div>
              <h4>Communes</h4>
              {communes === null ? (
                <Chargement />
              ) : communes.length === 0 ? (
                <p className="hint">Aucune commune renseignée.</p>
              ) : (
                <div className="rows">
                  {communes.map((c) => (
                    <div key={c.cle}>
                      <span>{c.cle}</span>
                      <span className="num">{formaterNombre(c.nombre)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4>À regarder en premier</h4>
              {points === null ? (
                <Chargement />
              ) : points.length === 0 ? (
                <p className="hint">Aucune entreprise géolocalisée.</p>
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
              {points && points.length < totalDescente ? `${formaterNombre(points.length)} points affichés sur ${formaterNombre(totalDescente)}. ` : ""}
              {source === "marche" ? "Points : les fiches prospectables du département. " : ""}
              <span style={{ color: "var(--blue)" }}>●</span> avec email. Cliquez un point pour ouvrir la fiche.
            </p>
          </>
        ) : (
          <>
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
            <div>
              <div className="ramp" />
              <div className="ends num">
                <span>{b ? fv(b.min) : "–"}</span>
                <span>{b ? fv(b.max) : "–"}</span>
              </div>
            </div>
            <div>
              <h4>Départements en tête</h4>
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
