"use client";

import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";

export const seDeconnecter = () => void signOut({ callbackUrl: "/login", redirect: true });

/** Compte connecté, toujours visible en haut à droite, téléphone compris. */
export function MenuCompte() {
  const { data } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOuvert(false);
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);
  const email = data?.user?.email ?? null;
  const nom = data?.user?.name?.trim() || email;
  return (
    <div className="mexport mcompte" ref={ref}>
      <button type="button" className="compte" aria-label="Mon compte" title={email ?? "Mon compte"} aria-haspopup="menu" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
        {(nom ?? "?").charAt(0).toUpperCase()}
      </button>
      {ouvert && (
        <div className="menu" role="menu">
          {email && (
            <p className="qui">
              {nom !== email && <b>{nom}</b>}
              <span>{email}</span>
            </p>
          )}
          <a role="menuitem" href={`${HUB}/dashboard`}>
            Mes applications Veridian
          </a>
          <button type="button" role="menuitem" onClick={seDeconnecter}>
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
