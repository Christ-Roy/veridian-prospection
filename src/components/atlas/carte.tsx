"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";

import { DEPARTMENT_NAMES, DEPARTMENT_PATHS } from "@/components/dashboard/france-map-data";

import { appeler, contoursCommunes, estAnnulation, texteErreur } from "./api";
import {
  bornes,
  cadrageCommune,
  cadreGroupe,
  cadrageDescente,
  chaleur,
  deplacerCadre,
  interpolerCadre,
  ECART_RONDS,
  placerPoints,
  rang,
  rayonGroupe,
  regrouper,
  valeurCommune,
  valeursCarte,
  VUE_FRANCE,
  zoomerCadre,
  type Mesure,
  type PointProjete,
} from "./carte-logique";
import { avecCondition } from "./flux";
import { Chargement, Icone } from "./icones";
import { formaterNombre } from "./logique";
import type { AnalyseMarche, Boite, ChampInfo, CommuneGeo, CommunesMarche, EpciGeo, Filtre, PointCarte, RepartitionMarche, ZoneLocale } from "./types";

const CODES = Object.keys(DEPARTMENT_PATHS);
const OFF = "#f1f5f9";
const OFF_LINE = "#d5dde7";
/** Lignes listées avant « Voir toutes ». */
const LIGNES_VISIBLES = 12;

type Props = {
  /** « marche » : toutes les entreprises (cube d'ODH) ; « prospection » : les fiches prospectables. */
  base?: "marche" | "prospection";
  filtre: Filtre;
  index: ReadonlyMap<string, ChampInfo>;
  descente: string | null;
  onDescente: (code: string | null) => void;
  /** Intercommunalité regardée dans le département (null : tout le département). */
  epci: ZoneLocale | null;
  onEpci: (e: ZoneLocale | null) => void;
  /** Commune regardée (null : tout le département ou toute l'intercommunalité). */
  commune: ZoneLocale | null;
  onCommune: (c: ZoneLocale | null) => void;
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

const boiteDe = (g: { x: number; y: number; w: number; h: number }): Boite => ({ x: g.x, y: g.y, width: g.w, height: g.h });

export function Carte({ base: source = "prospection", filtre, index, descente, onDescente, epci, onEpci, commune, onCommune, onFiche }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cadre = useRef<number[]>([...VUE_FRANCE]);
  const anim = useRef(0);
  const glisse = useRef<{ x: number; y: number; bouge: boolean } | null>(null);
  const [largeur, setLargeur] = useState<number>(VUE_FRANCE[2]);
  const [mesure, setMesure] = useState<Mesure>("nombre");
  const [base, setBase] = useState<RepartitionMarche["valeurs"] | null>(null);
  const [partie, setPartie] = useState<RepartitionMarche["valeurs"] | null>(null);
  const [points, setPoints] = useState<PointCarte[] | null>(null);
  const [geo, setGeo] = useState<{ communes: CommuneGeo[]; epcis: EpciGeo[] } | null>(null);
  const [comptes, setComptes] = useState<CommunesMarche | null>(null);
  const [decoupage, setDecoupage] = useState<"epci" | "commune">("epci");
  const [toutes, setToutes] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pile, setPile] = useState<PointProjete[] | null>(null);
  const doigts = useRef(new Map<number, { x: number; y: number }>());
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

  // Descente : contours (communes, intercommunalités) et comptes du département.
  useEffect(() => {
    setGeo(null);
    setComptes(null);
    setToutes(false);
    if (!descente) return;
    const ctl = new AbortController();
    contoursCommunes(descente, ctl.signal)
      .then((g) => {
        setGeo(g);
        setDecoupage(g.epcis.length > 1 ? "epci" : "commune");
      })
      .catch((e) => {
        if (estAnnulation(e)) return;
        setGeo({ communes: [], epcis: [] }); // la carte reste utilisable sans contours : listes et points
        setDecoupage("commune");
        setErreur(texteErreur(e));
      });
    appeler<CommunesMarche>("repartir_communes", { filtre: JSON.parse(cle) as Filtre, departement: descente, base: source }, ctl.signal)
      .then(setComptes)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, descente, source]);

  // Points : les fiches prospectables du département, de l'intercommunalité ou de la commune.
  const codesZone = commune ? commune.code : (epci?.communes ?? []).join(",");
  useEffect(() => {
    setPoints(null);
    if (!descente) return;
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    const codes = codesZone ? codesZone.split(",").filter((c) => /^\d[\dAB]\d{3}$/.test(c)) : [];
    const ici = codes.length ? avecCondition(f, { champ: "commune_insee", op: "dans", valeur: codes }) : f;
    appeler<{ points: PointCarte[] }>("points_carte", { filtre: ici, departement: descente, limite: 400 }, ctl.signal)
      .then((p) => setPoints(p.points))
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, descente, codesZone]);

  // Les chiffres des zones regardées suivent le filtre (le parent en tire ses chiffres clés).
  useEffect(() => {
    if (!comptes) return;
    if (epci) {
      const e = comptes.intercommunalites.find((x) => x.code === epci.code);
      const frais = e ? { code: e.code, nom: e.nom, communes: e.communes, mesures: e.mesures } : { ...epci, mesures: { entreprises: 0 } };
      if (JSON.stringify(frais.mesures) !== JSON.stringify(epci.mesures)) onEpci(frais);
    }
  }, [comptes, epci, onEpci]);
  useEffect(() => {
    if (!comptes || !commune) return;
    const c = comptes.communes.find((x) => x.code === commune.code);
    const mesuresFraiches = c?.mesures ?? { entreprises: 0 };
    if (JSON.stringify(mesuresFraiches) !== JSON.stringify(commune.mesures)) onCommune({ code: commune.code, nom: commune.nom, mesures: mesuresFraiches });
  }, [comptes, commune, onCommune]);

  const geoCommune = useMemo(() => new Map((geo?.communes ?? []).map((c) => [c.code, c])), [geo]);
  const geoEpci = useMemo(() => new Map((geo?.epcis ?? []).map((e) => [e.code, e])), [geo]);
  const contourCommune = commune ? (geoCommune.get(commune.code) ?? null) : null;
  const contourEpci = epci ? (geoEpci.get(epci.code) ?? null) : null;
  const niveau: "france" | "dep" | "epci" | "commune" = commune ? "commune" : epci ? "epci" : descente ? "dep" : "france";

  // ---------------------------------------------------------------- cadrage et zoom
  const allerA = useCallback((vers: readonly number[], duree: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    cancelAnimationFrame(anim.current);
    const de = [...cadre.current];
    const t0 = performance.now();
    const d = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duree;
    const pas = (t: number) => {
      const k = d ? Math.min(1, (t - t0) / d) : 1;
      cadre.current = interpolerCadre(de, vers, k);
      svg.setAttribute("viewBox", cadre.current.join(" "));
      if (k < 1) anim.current = requestAnimationFrame(pas);
      else setLargeur(cadre.current[2]);
    };
    anim.current = requestAnimationFrame(pas);
  }, []);

  /** Cadre du niveau regardé : France, département, intercommunalité ou commune. */
  const cadreNiveau = useCallback((): number[] => {
    const svg = svgRef.current;
    if (!svg || !descente) return [...VUE_FRANCE];
    const chemin = svg.querySelector<SVGPathElement>(`path[data-c="${descente}"]`);
    if (!chemin) return [...VUE_FRANCE];
    const bb = chemin.getBBox();
    const dep = Math.max(bb.width, bb.height);
    if (contourCommune) return cadrageCommune(boiteDe(contourCommune), dep / 10);
    if (contourEpci) return cadrageCommune(boiteDe(contourEpci), dep / 6);
    return cadrageDescente({ x: bb.x, y: bb.y, width: bb.width, height: bb.height });
  }, [descente, contourCommune, contourEpci]);

  useEffect(() => {
    allerA(cadreNiveau(), 520);
    return () => cancelAnimationFrame(anim.current);
  }, [cadreNiveau, allerA]);

  /** Coordonnées de la carte sous un point de l'écran. */
  const versCarte = (cx: number, cy: number): [number, number] => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return [cadre.current[0] + cadre.current[2] / 2, cadre.current[1] + cadre.current[3] / 2];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const zoomer = (facteur: number, cx?: number, cy?: number) => {
    const c = cadre.current;
    const [x, y] = cx === undefined || cy === undefined ? [c[0] + c[2] / 2, c[1] + c[3] / 2] : versCarte(cx, cy);
    allerA(zoomerCadre(c, facteur, x, y), 160);
  };

  // Molette : zoom autour du curseur (écouteur non passif pour ne pas faire défiler la page en même temps).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const roue = (e: WheelEvent) => {
      e.preventDefault();
      const c = cadre.current;
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      cancelAnimationFrame(anim.current);
      cadre.current = zoomerCadre(c, Math.exp(-e.deltaY * 0.0022), p.x, p.y);
      svg.setAttribute("viewBox", cadre.current.join(" "));
      setLargeur(cadre.current[2]);
    };
    svg.addEventListener("wheel", roue, { passive: false });
    return () => svg.removeEventListener("wheel", roue);
  }, []);

  // Glisser pour se déplacer ; un glisser n'est pas un clic.
  const appui = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    doigts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (doigts.current.size === 2) {
      // Deux doigts : on pince, ce n'est plus un glisser.
      glisse.current = { x: e.clientX, y: e.clientY, bouge: true };
      return;
    }
    glisse.current = { x: e.clientX, y: e.clientY, bouge: false };
  };
  const deplacement = (e: PointerEvent<SVGSVGElement>) => {
    const g = glisse.current;
    const svg = svgRef.current;
    if (!g || !svg) return;
    const avant = doigts.current.get(e.pointerId);
    if (avant && doigts.current.size === 2) {
      const autre = [...doigts.current].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(avant.x - autre.x, avant.y - autre.y), d1 = Math.hypot(e.clientX - autre.x, e.clientY - autre.y);
      doigts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (d0 < 1 || d1 < 1) return;
      const [x, y] = versCarte((e.clientX + autre.x) / 2, (e.clientY + autre.y) / 2);
      cancelAnimationFrame(anim.current);
      cadre.current = zoomerCadre(cadre.current, d1 / d0, x, y);
      svg.setAttribute("viewBox", cadre.current.join(" "));
      setLargeur(cadre.current[2]);
      return;
    }
    const dxp = e.clientX - g.x;
    const dyp = e.clientY - g.y;
    if (!g.bouge && Math.hypot(dxp, dyp) < 4) return;
    if (!g.bouge) svg.setPointerCapture(e.pointerId);
    g.bouge = true;
    const echelle = cadre.current[2] / svg.getBoundingClientRect().width;
    cancelAnimationFrame(anim.current);
    cadre.current = deplacerCadre(cadre.current, dxp * echelle, dyp * echelle);
    svg.setAttribute("viewBox", cadre.current.join(" "));
    g.x = e.clientX;
    g.y = e.clientY;
    setBulle(null);
  };
  const relache = (e: PointerEvent<SVGSVGElement>) => {
    doigts.current.delete(e.pointerId);
    if (doigts.current.size) {
      // Reste un doigt après un pincement : il reprend le glisser d'où il est.
      const [d] = [...doigts.current.values()];
      glisse.current = { x: d.x, y: d.y, bouge: true };
      return;
    }
    if (glisse.current?.bouge && svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    // Le clic qui suit un glisser est ignoré (voir clic).
    setTimeout(() => (glisse.current = null), 0);
  };

  // ---------------------------------------------------------------- valeurs
  const valeurs = useMemo(() => (base ? valeursCarte(base, mesure === "nombre" ? null : (partie ?? [])) : new Map<string, number>()), [base, partie, mesure]);
  const effectifs = useMemo(() => (base ? valeursCarte(base, null) : new Map<string, number>()), [base]);
  const b = bornes(valeurs.values());
  const enPct = mesure !== "nombre";
  const fv = (v: number) => (enPct ? `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : formaterNombre(Math.round(v)));
  const unite =
    mesure === "nombre" ? "entreprises" : mesure === "sans_site" ? "sans site web" : mesure === "contactable" ? "contactables" : mesure === "email_envoyable" ? "email envoyable" : "avec email";
  const nom = (c: string) => DEPARTMENT_NAMES[c] ?? c;
  // Échelle logarithmique pour les nombres : la préfecture écraserait tout.
  const echelle = (v: number) => (enPct ? v : Math.log1p(v));

  const comptesCommune = useMemo(() => new Map((comptes?.communes ?? []).map((c) => [c.code, c])), [comptes]);
  const comptesEpci = useMemo(() => new Map((comptes?.intercommunalites ?? []).map((e) => [e.code, e])), [comptes]);
  const valeursCommunes = useMemo(() => new Map((comptes?.communes ?? []).map((c) => [c.code, valeurCommune(mesure, c.mesures)])), [comptes, mesure]);
  const valeursEpcis = useMemo(() => new Map((comptes?.intercommunalites ?? []).map((e) => [e.code, valeurCommune(mesure, e.mesures)])), [comptes, mesure]);
  // Communes de la zone : celles de l'intercommunalité regardée, sinon tout le département.
  const dansZone = useCallback((code: string) => !epci || (epci.communes ?? []).includes(code), [epci]);
  const bc = bornes([...valeursCommunes].filter(([c]) => dansZone(c)).map(([, v]) => echelle(v)));
  const be = bornes([...valeursEpcis.values()].map(echelle));
  const parValeur = <T extends { code: string; mesures: Record<string, number> }>(l: readonly T[], v: ReadonlyMap<string, number>) =>
    [...l].sort((x, y) => (v.get(y.code) ?? 0) - (v.get(x.code) ?? 0) || (y.mesures.entreprises ?? 0) - (x.mesures.entreprises ?? 0));
  const communesZone = useMemo(() => parValeur((comptes?.communes ?? []).filter((c) => dansZone(c.code)), valeursCommunes), [comptes, valeursCommunes, dansZone]);
  const epcisClasses = useMemo(() => parValeur(comptes?.intercommunalites ?? [], valeursEpcis), [comptes, valeursEpcis]);
  const voirEpcis = niveau === "dep" && decoupage === "epci" && (geo?.epcis.length ?? 0) > 1;

  // Noms posés sur la carte, sans chevauchement : intercommunalités ou communes les plus fournies.
  const etiquettes = useMemo(() => {
    if (!geo || niveau === "commune") return [];
    const sources: { x: number; y: number; w: number; h: number; nom: string; code: string }[] = voirEpcis
      ? epcisClasses.map((e) => geoEpci.get(e.code)).filter((g): g is EpciGeo => !!g)
      : communesZone.map((c) => geoCommune.get(c.code)).filter((g): g is CommuneGeo => !!g);
    const ecart = largeur / 9;
    const poses: typeof sources = [];
    for (const g of sources) {
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      if (poses.some((o) => Math.abs(o.x + o.w / 2 - cx) < ecart && Math.abs(o.y + o.h / 2 - cy) < ecart / 3)) continue;
      poses.push(g);
      if (poses.length === 6) break;
    }
    return poses;
  }, [geo, niveau, voirEpcis, epcisClasses, communesZone, geoEpci, geoCommune, largeur]);

  // Une adresse mal géolocalisée par ODH peut tomber hors du département : on ne la dessine pas.
  const projetes = useMemo(() => {
    const tous = points ? placerPoints(points) : [];
    const chemin = descente ? svgRef.current?.querySelector<SVGPathElement>(`path[data-c="${descente}"]`) : null;
    if (!chemin || typeof DOMPoint === "undefined") return tous;
    return tous.filter((p) => chemin.isPointInFill(new DOMPoint(p.x, p.y)));
  }, [points, descente]);
  const horsZone = (points?.length ?? 0) - projetes.length;
  // Taille constante à l'écran : zoomer sépare les points qui se chevauchent.
  const rayon = largeur / 150;
  const groupes = useMemo(() => regrouper(projetes, (largeur / 150) * ECART_RONDS), [projetes, largeur]);
  useEffect(() => setPile(null), [cle, descente, codesZone]);

  // ---------------------------------------------------------------- navigation
  const ouvrirEpci = (code: string) => {
    const e = comptesEpci.get(code);
    const g = geoEpci.get(code);
    onEpci({ code, nom: e?.nom ?? g?.nom ?? code, communes: e?.communes ?? g?.communes ?? [], mesures: e?.mesures ?? { entreprises: 0 } });
  };
  const ouvrirCommune = (code: string) => {
    const g = geoCommune.get(code);
    const c = comptesCommune.get(code);
    // Une commune hors de l'intercommunalité regardée fait changer d'intercommunalité.
    if (epci && !dansZone(code) && g?.epci) ouvrirEpci(g.epci);
    onCommune({ code, nom: c?.nom ?? g?.nom ?? code, mesures: c?.mesures ?? { entreprises: 0 } });
  };
  const remonter = () => (commune ? onCommune(null) : epci ? onEpci(null) : descente ? onDescente(null) : undefined);

  const survol = (e: MouseEvent<SVGSVGElement>) => {
    if (glisse.current?.bouge) return;
    const el = e.target as Element;
    const wrap = svgRef.current?.parentElement?.getBoundingClientRect();
    if (!wrap) return;
    const pos = { x: e.clientX - wrap.left, y: e.clientY - wrap.top };
    const dot = el.closest<SVGCircleElement>("circle[data-s]");
    if (dot) {
      const g = groupes.find((x) => x.cle === dot.dataset.s);
      if (g) return setBulle({ ...pos, texte: g.points.length > 1 ? `${formaterNombre(g.points.length)} entreprises · ${g.points[0].nom}, ${g.points[1].nom}${g.points.length > 2 ? "…" : ""}` : `${g.points[0].nom} · ${g.points[0].commune}` });
    }
    const ep = el.closest<SVGPathElement>("path[data-e]");
    if (ep) {
      const g = geoEpci.get(ep.dataset.e ?? "");
      const v = valeursEpcis.get(ep.dataset.e ?? "");
      if (g) return setBulle({ ...pos, texte: `${g.nom} · ${v === undefined ? "aucune entreprise" : `${fv(v)} ${unite}`}` });
    }
    const com = el.closest<SVGPathElement>("path[data-m]");
    if (com) {
      const g = geoCommune.get(com.dataset.m ?? "");
      const v = valeursCommunes.get(com.dataset.m ?? "");
      if (g) return setBulle({ ...pos, texte: `${g.nom} · ${v === undefined ? "aucune entreprise" : `${fv(v)} ${unite}`}` });
    }
    const chemin = el.closest<SVGPathElement>("path[data-c]");
    if (chemin && chemin.dataset.c !== descente) {
      const c = chemin.dataset.c ?? "";
      const v = valeurs.get(c);
      return setBulle({ ...pos, texte: `${nom(c)} · ${v === undefined ? "hors zone" : `${fv(v)} ${unite}`}` });
    }
    setBulle(null);
  };

  const clic = (e: MouseEvent<SVGSVGElement>) => {
    if (glisse.current?.bouge) return;
    const el = e.target as Element;
    const dot = el.closest<SVGCircleElement>("circle[data-s]");
    if (dot) {
      const g = groupes.find((x) => x.cle === dot.dataset.s);
      if (!g) return;
      if (g.points.length === 1) return onFiche(g.points[0].siren, g.points[0].nom);
      const c = cadreGroupe(g, cadre.current[2]);
      if (c) return allerA(c, 420);
      setBulle(null);
      setPile(g.points);
      return;
    }
    const ep = el.closest<SVGPathElement>("path[data-e]")?.dataset.e;
    if (ep) return ouvrirEpci(ep);
    const m = el.closest<SVGPathElement>("path[data-m]")?.dataset.m;
    if (m) return m === commune?.code ? onCommune(null) : ouvrirCommune(m);
    const c = el.closest<SVGPathElement>("path[data-c]")?.dataset.c;
    if (c === descente) return remonter();
    if (c && c !== descente && effectifs.has(c)) onDescente(c);
  };

  // ---------------------------------------------------------------- rendu
  const top = [...valeurs].sort((x, y) => y[1] - x[1]).slice(0, 7);
  const nonRapprochees = comptes?.non_rapprochees.entreprises ?? 0;
  const ligne = (z: { code: string; nom: string }, v: number | undefined, ouvrir: (code: string) => void, courant: boolean) => (
    <button key={z.code} type="button" onClick={() => ouvrir(z.code)} aria-current={courant ? "true" : undefined}>
      <span>{z.nom}</span>
      <span className="num">{fv(v ?? 0)}</span>
    </button>
  );
  const liste = <T extends { code: string; nom: string }>(l: readonly T[], v: ReadonlyMap<string, number>, ouvrir: (code: string) => void, quoi: string) => (
    <>
      <div className={toutes ? "rows liste-longue" : "rows"}>{(toutes ? l : l.slice(0, LIGNES_VISIBLES)).map((z) => ligne(z, v.get(z.code), ouvrir, z.code === commune?.code))}</div>
      {l.length > LIGNES_VISIBLES && (
        <button type="button" className="lnk" onClick={() => setToutes((t) => !t)}>
          {toutes ? "Réduire" : `Voir les ${formaterNombre(l.length)} ${quoi}`}
        </button>
      )}
    </>
  );
  const chiffres = (z: ZoneLocale) => (
    <div className="rows">
      <div>
        <span>{source === "marche" ? "Entreprises du marché" : "Entreprises de la cible"}</span>
        <span className="num">{formaterNombre(z.mesures.entreprises ?? 0)}</span>
      </div>
      {source === "marche" && z.mesures.contactables !== undefined && (
        <div>
          <span>Contactables</span>
          <span className="num">{formaterNombre(z.mesures.contactables)}</span>
        </div>
      )}
      {z.mesures.email_envoyable !== undefined && (
        <div>
          <span>Email envoyable</span>
          <span className="num">{formaterNombre(z.mesures.email_envoyable)}</span>
        </div>
      )}
      {z.mesures.telephone_envoyable !== undefined && (
        <div>
          <span>Téléphone utilisable</span>
          <span className="num">{formaterNombre(z.mesures.telephone_envoyable)}</span>
        </div>
      )}
    </div>
  );
  const legendePoints = (
    <>
      <span style={{ color: "var(--blue)" }}>●</span> avec email, <span style={{ color: "#64748b" }}>●</span> sans. Molette ou boutons pour zoomer, glisser pour se déplacer.
      {horsZone > 0 ? ` ${formaterNombre(horsZone)} adresse${horsZone > 1 ? "s" : ""} hors du département non dessinée${horsZone > 1 ? "s" : ""}.` : ""}
    </>
  );
  const mieuxNotees = (titre: string) => (
    <div>
      <h4>{titre}</h4>
      {points === null ? (
        <Chargement />
      ) : points.length === 0 ? (
        <p className="hint">Aucune fiche contactable géolocalisée ici.</p>
      ) : (
        <div className="rows liste-longue">
          {points.slice(0, niveau === "commune" ? 200 : 8).map((p) => (
            <button key={p.siren} type="button" onClick={() => onFiche(p.siren, p.nom)}>
              <span>{p.nom}</span>
              <span>{niveau === "commune" ? (p.email ? "email" : "") : p.commune}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
              : epci
                ? `Carte de ${epci.nom}, communes colorées selon la mesure choisie`
                : descente
                  ? `Carte du département ${nom(descente)}, colorée selon la mesure choisie`
                  : "Carte des départements, colorée selon la mesure choisie"
          }
          onMouseMove={survol}
          onMouseLeave={() => setBulle(null)}
          onClick={clic}
          onPointerDown={appui}
          onPointerMove={deplacement}
          onPointerUp={relache}
          onPointerCancel={relache}
          style={{ touchAction: "none" }}
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
                  vectorEffect="non-scaling-stroke"
                  opacity={descente && !focus ? 0.35 : 1}
                />
              );
            })}
          </g>
          {descente && geo && voirEpcis && (
            <g>
              {geo.epcis.map((g) => {
                const v = valeursEpcis.get(g.code);
                const fill = v === undefined || !be ? OFF : chaleur(rang(echelle(v), be.min, be.max));
                return (
                  <path key={g.code} data-e={g.code} className="commune" d={g.d} fill={fill} stroke="#fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke">
                    <title>{g.nom}</title>
                  </path>
                );
              })}
            </g>
          )}
          {descente && geo && !voirEpcis && (
            <g>
              {geo.communes.map((g) => {
                const v = valeursCommunes.get(g.code);
                const focus = g.code === commune?.code;
                const dedans = dansZone(g.code);
                // La commune regardée s'éclaircit pour laisser lire ses points, comme le département en descente.
                const fill = focus ? "hsl(217 60% 97%)" : v === undefined || !bc || !dedans ? OFF : chaleur(rang(echelle(v), bc.min, bc.max));
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
                    opacity={(commune && !focus) || !dedans ? 0.45 : 1}
                  >
                    <title>{g.nom}</title>
                  </path>
                );
              })}
              {contourEpci && <path d={contourEpci.d} fill="none" stroke="hsl(217 90% 45%)" strokeWidth={commune ? 1.2 : 2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
              {contourCommune && <path d={contourCommune.d} fill="none" stroke="hsl(217 90% 45%)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
            </g>
          )}
          <g>
            {etiquettes.map((g) => (
              <text key={g.code} className="etiq" x={g.x + g.w / 2} y={g.y + g.h / 2} fontSize={largeur / 50} textAnchor="middle" dominantBaseline="middle">
                {g.nom}
              </text>
            ))}
          </g>
          <g>
            {groupes.map((g) => (
              <g key={g.cle}>
                <circle
                  className="dot"
                  data-s={g.cle}
                  cx={g.x.toFixed(4)}
                  cy={g.y.toFixed(4)}
                  r={(rayon * rayonGroupe(g.points.length)).toFixed(4)}
                  fill={g.email ? "hsl(217 90% 55%)" : "#64748b"}
                  fillOpacity={0.85}
                  stroke="#fff"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
                {g.points.length > 1 && (
                  <text x={g.x} y={g.y} fontSize={rayon * 1.9} fill="#fff" textAnchor="middle" dominantBaseline="central" pointerEvents="none" fontWeight={600}>
                    {g.points.length}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
        <div className="zoom" role="group" aria-label="Zoom de la carte">
          <button type="button" onClick={() => zoomer(1.6)} aria-label="Zoomer" title="Zoomer">
            +
          </button>
          <button type="button" onClick={() => zoomer(1 / 1.6)} aria-label="Dézoomer" title="Dézoomer">
            −
          </button>
          <button type="button" onClick={() => allerA(cadreNiveau(), 400)} aria-label="Recadrer" title="Recadrer sur la zone">
            ⤢
          </button>
        </div>
        {pile && (
          <div className="pile" role="dialog" aria-label="Entreprises à cette adresse">
            <div className="ptete">
              <b>{formaterNombre(pile.length)} entreprises à cette adresse</b>
              <button type="button" className="x" aria-label="Fermer la liste" onClick={() => setPile(null)}>
                <Icone nom="x" />
              </button>
            </div>
            <div className="rows liste-longue">
              {pile.map((p) => (
                <button key={p.siren} type="button" onClick={() => onFiche(p.siren, p.nom)}>
                  <span>{p.nom}</span>
                  <span>{p.email ? "email" : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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
        {niveau === "commune" && commune ? (
          <>
            <div>
              <h4>{commune.nom}</h4>
              {chiffres(commune)}
            </div>
            {mieuxNotees("Entreprises contactables")}
            <p className="hint">
              <button type="button" className="lnk" onClick={() => onCommune(null)}>
                Revenir à {epci?.nom ?? nom(descente ?? "")}
              </button>{" "}
              · {legendePoints}
            </p>
          </>
        ) : niveau === "epci" && epci ? (
          <>
            <div>
              <h4>{epci.nom}</h4>
              {chiffres(epci)}
            </div>
            <div>
              <h4>Communes</h4>
              {comptes === null ? <Chargement /> : communesZone.length === 0 ? <p className="hint">Aucune entreprise ici.</p> : liste(communesZone, valeursCommunes, ouvrirCommune, "communes")}
            </div>
            {mieuxNotees("Les mieux notées")}
            <p className="hint">
              <button type="button" className="lnk" onClick={() => onEpci(null)}>
                Revenir à {nom(descente ?? "")}
              </button>{" "}
              · Cliquez une commune pour y descendre. {legendePoints}
            </p>
          </>
        ) : niveau === "dep" ? (
          <>
            {(geo?.epcis.length ?? 0) > 1 && (
              <div>
                <h4>Découpage</h4>
                <div className="seg3" role="group" aria-label="Découpage du département">
                  {(
                    [
                      ["epci", "Intercommunalités"],
                      ["commune", "Communes"],
                    ] as const
                  ).map(([id, libelle]) => (
                    <button key={id} type="button" className={decoupage === id ? "on" : undefined} aria-pressed={decoupage === id} onClick={() => (setDecoupage(id), setToutes(false))}>
                      {libelle}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h4>{voirEpcis ? "Intercommunalités" : "Communes"}</h4>
              {comptes === null || geo === null ? (
                <Chargement />
              ) : voirEpcis ? (
                epcisClasses.length === 0 ? <p className="hint">Aucune entreprise dans ce département.</p> : liste(epcisClasses, valeursEpcis, ouvrirEpci, "intercommunalités")
              ) : communesZone.length === 0 ? (
                <p className="hint">Aucune entreprise dans ce département.</p>
              ) : (
                liste(communesZone, valeursCommunes, ouvrirCommune, "communes")
              )}
            </div>
            {mieuxNotees("Les mieux notées")}
            <p className="hint">
              {voirEpcis ? "Métropoles, communautés d'agglomération et de communes : cliquez-en une pour y descendre. " : "Cliquez une commune pour y descendre. "}
              {comptes?.repli ? "Marché trop large pour la base complète : les zones comptent les fiches contactables. " : ""}
              {nonRapprochees > 0 ? `${formaterNombre(nonRapprochees)} entreprises sans commune reconnue. ` : ""}
              Points : les fiches contactables. {legendePoints}
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
            <p className="hint">Cliquez un département pour y descendre. Molette ou boutons pour zoomer.</p>
          </>
        )}
      </div>
    </div>
  );
}
