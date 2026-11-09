/** Icônes de la maquette (16 px, trait 1,5) : mêmes tracés, pour garder le dessin exact. */
const TRACES = {
  carte: "M2 3.8l4-1.6 4 1.6 4-1.6v10l-4 1.6-4-1.6-4 1.6zM6 2.2v10M10 3.8v10",
  barres: "M2.5 4h7M2.5 8h11M2.5 12h5",
  marche: "M8 2.5a5.5 5.5 0 105.5 5.5H8zM10 1.8A5 5 0 0114.2 6H10z",
  entonnoir: "M2 3h12l-4.5 5v5l-3 1V8z",
  tableau: "M2.5 3h11v10h-11zM2.5 6.5h11M6.5 6.5V13",
  priorite: "M3 12.5V9M6.5 12.5V6M10 12.5V3.5M13.5 12.5h-12",
  cible: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
  dossier: "M2 4.5v8h12v-7H8L6.5 3.5H2z",
  segment: "M2.5 4.5l5.5 4 5.5-4M2.5 4h11v8.5h-11z",
  vue: "M8 3.5C4.5 3.5 2 8 2 8s2.5 4.5 6 4.5S14 8 14 8s-2.5-4.5-6-4.5zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6",
  note: "M3 2.5h10v11H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3",
  ent: "M3 13.5V5l5-2.5L13 5v8.5M6 13.5V9h4v4.5",
  x: "M4 4l8 8M12 4l-8 8",
  filtre: "M2.5 4h11M4.5 8h7M6.5 12h3",
  plus: "M8 3v10M3 8h10",
  chev: "M6 4l4 4-4 4",
  retour: "M10 4L6 8l4 4",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  colonnes: "M2.5 3h11v10h-11zM6.2 3v10M9.8 3v10",
  envoi: "M2.5 4.5l5.5 4 5.5-4M2.5 4h11v8.5h-11z",
  historique: "M2.5 8a5.5 5.5 0 105.5-5.5A5.6 5.6 0 004 4.3M2.5 2.5v2.5H5M8 5v3l2 1.5",
  alerte: "M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.1",
  charge: "M8 2.5a5.5 5.5 0 105.5 5.5",
} as const;

export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, className = "i", label }: { nom: NomIcone; className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      <path d={TRACES[nom]} />
    </svg>
  );
}

export function Chargement({ texte = "Chargement…" }: { texte?: string }) {
  return (
    <p className="loading" role="status">
      <svg className="i spin" viewBox="0 0 16 16" aria-hidden>
        <path d={TRACES.charge} />
      </svg>
      {texte}
    </p>
  );
}
