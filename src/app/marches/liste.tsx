"use client";

import { useMemo, useState } from "react";

type Marche = { naf: string; libelle: string; n: number; chemin: string };
const nu = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function ListeMarches({ marches }: { marches: Marche[] }) {
  const [q, setQ] = useState("");
  const vus = useMemo(() => {
    const mots = nu(q).split(/\s+/).filter(Boolean);
    return marches.filter((m) => mots.every((x) => nu(`${m.naf} ${m.libelle}`).includes(x)));
  }, [q, marches]);
  return (
    <>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Restaurant, vétérinaire, 4711D…" aria-label="Chercher une activité" className="mt-6 w-full rounded-lg border border-neutral-300 px-3 py-2 text-[15px] outline-none focus:border-neutral-900" />
      <p className="mt-2 text-xs text-neutral-500" role="status">
        {vus.length.toLocaleString("fr-FR")} activités
      </p>
      <ul className="mt-3 divide-y divide-neutral-200">
        {vus.slice(0, q ? 200 : 60).map((m) => (
          <li key={m.naf}>
            <a href={m.chemin} className="flex items-baseline justify-between gap-4 py-2.5 text-sm hover:bg-neutral-50">
              <span className="min-w-0">
                {m.libelle} <span className="text-neutral-400">{m.naf}</span>
              </span>
              <span className="shrink-0 tabular-nums text-neutral-600">{m.n.toLocaleString("fr-FR")}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
