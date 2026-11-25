import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { cheminMarche, lireNaf, marchePublic } from "@/atlas/marches-publics";
import { NAF_LIBELLES } from "@/atlas/naf";

import { CadrePublic, Invitation } from "../cadre";

export const dynamic = "force-dynamic";
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://prospection.app.veridian.site";
/** L'indexation par les moteurs est une décision de Robert : fermée tant que la variable n'est pas posée. */
const INDEXER = process.env.ATLAS_PUBLIC_INDEX === "1";
const n = (x: number) => x.toLocaleString("fr-FR");
const pc = (a: number, b: number) => (b ? `${Math.round((a * 100) / b)} %` : "–");

type Props = { params: Promise<{ naf: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const naf = lireNaf((await params).naf);
  if (!naf) return { title: "Marché introuvable", robots: { index: false } };
  return {
    title: `${NAF_LIBELLES[naf]} : le marché en France`,
    description: `Combien d'entreprises, où, quelle taille, combien de créations : le marché « ${NAF_LIBELLES[naf]} » (NAF ${naf}) en chiffres.`,
    alternates: { canonical: `${SITE}${cheminMarche(naf)}` },
    robots: { index: INDEXER, follow: INDEXER },
  };
}

function Barres({ titre, lignes }: { titre: string; lignes: { libelle: string; n: number }[] }) {
  const max = Math.max(1, ...lignes.map((l) => l.n));
  if (!lignes.length) return null;
  return (
    <section className="mt-9">
      <h2 className="text-lg font-semibold">{titre}</h2>
      <ul className="mt-3 space-y-2">
        {lignes.map((l) => (
          <li key={l.libelle} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5rem] items-center gap-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)_6rem]">
            <span className="truncate">{l.libelle}</span>
            <span className="h-3 rounded bg-neutral-100">
              <span className="block h-3 rounded bg-blue-600" style={{ width: `${Math.max(1, (l.n * 100) / max)}%` }} />
            </span>
            <span className="text-right tabular-nums text-neutral-600">{n(l.n)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PageMarche({ params }: Props) {
  const { naf: param } = await params;
  const naf = lireNaf(param);
  if (!naf) notFound();
  if (`/marche/${param}` !== cheminMarche(naf)) permanentRedirect(cheminMarche(naf));
  const m = await marchePublic(naf).catch((e) => {
    console.error("[marche-public]", naf, e instanceof Error ? e.message : e);
    return null;
  });
  if (!m)
    return (
      <CadrePublic>
        <h1 className="text-2xl font-semibold">{NAF_LIBELLES[naf]}</h1>
        <p className="mt-3 text-neutral-600">Les chiffres sont momentanément indisponibles. Réessayez dans une minute.</p>
      </CadrePublic>
    );
  const kpis: [string, string][] = [
    [n(m.total.entreprises), "entreprises actives"],
    [n(m.total.prospectables), `contactables (${pc(m.total.prospectables, m.total.entreprises)})`],
    [n(m.total.email_envoyable), "avec un email utilisable"],
    [n(m.total.telephone_envoyable), "avec un téléphone utilisable"],
  ];
  const max = Math.max(1, ...m.creations.map((c) => c.n));
  return (
    <CadrePublic>
      <p className="text-sm text-neutral-500">
        <a href="/marches" className="hover:underline">
          Tous les marchés
        </a>{" "}
        · NAF {naf}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{m.libelle}</h1>
      <p className="mt-2 text-neutral-600">Le marché français : combien d&apos;entreprises, où elles sont, quelle taille elles font.</p>
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        {kpis.map(([v, l]) => (
          <div key={l}>
            <dt className="sr-only">{l}</dt>
            <dd>
              <b className="block text-2xl font-semibold tabular-nums tracking-tight">{v}</b>
              <span className="text-sm text-neutral-500">{l}</span>
            </dd>
          </div>
        ))}
      </dl>
      <Barres titre="Départements en tête" lignes={m.departements} />
      <section className="mt-9">
        <h2 className="text-lg font-semibold">Créations par année</h2>
        <div className="mt-3 flex h-36 items-end gap-1.5" role="img" aria-label={`Créations par année, de ${m.creations[0].annee} à ${m.creations[m.creations.length - 1].annee}`}>
          {m.creations.map((c) => (
            <div key={c.annee} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${c.annee} : ${n(c.n)}`}>
              <div className="rounded-t bg-blue-600" style={{ height: `${(c.n * 100) / max}%` }} />
              <span className="mt-1 text-center text-[10px] text-neutral-500">{String(c.annee).slice(2)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">Entreprises encore actives aujourd&apos;hui, par année de création. L&apos;année en cours est incomplète.</p>
      </section>
      <Barres titre="Taille (salariés)" lignes={m.tailles} />
      <Invitation quoi="ce marché" />
    </CadrePublic>
  );
}
