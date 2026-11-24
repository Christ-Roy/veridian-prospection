"use client";

import { useEffect, useState } from "react";

import { Icone } from "./icones";

type Espace = { id: string; nom: string; role: string; membres: number };

const ROLES: Record<string, string> = { owner: "propriétaire", admin: "administrateur", member: "membre", viewer: "lecture seule" };

/** Organisation où l'on travaille. Rien ne s'affiche à qui n'en a qu'une et y est seul. */
export function ChoixEspace() {
  const [e, setE] = useState<{ courant: string; espaces: Espace[] } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/espaces", { credentials: "same-origin", signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !ctl.signal.aborted && setE(j))
      .catch(() => undefined);
    return () => ctl.abort();
  }, []);
  if (!e || (e.espaces.length < 2 && (e.espaces[0]?.membres ?? 1) < 2)) return null;

  const choisir = async (id: string) => {
    setEnvoi(true);
    setErreur(false);
    try {
      const r = await fetch("/api/espaces", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error();
      // Tout l'écran appartient à l'organisation : on repart d'une page neuve.
      window.location.assign("/");
    } catch {
      setErreur(true);
      setEnvoi(false);
    }
  };

  return (
    <div className="rsec">
      <div className="rhead lbl">Organisation</div>
      {e.espaces.map((x) => (
        <button key={x.id} type="button" className={x.id === e.courant ? "ritem on" : "ritem"} aria-current={x.id === e.courant ? "true" : undefined} disabled={envoi || x.id === e.courant} title={`${x.nom} · ${ROLES[x.role] ?? x.role} · ${x.membres} membre${x.membres > 1 ? "s" : ""}`} onClick={() => void choisir(x.id)}>
          <Icone nom="ent" />
          <span className="lbl">{x.nom}</span>
          <span className="n lbl">{x.membres}</span>
        </button>
      ))}
      {erreur && <div className="rhead lbl" role="alert">Changement impossible, réessayez.</div>}
    </div>
  );
}
