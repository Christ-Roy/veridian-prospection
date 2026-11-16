"use client";

import { useEffect, useState } from "react";

import { appeler, estAnnulation, texteErreur } from "./api";
import { Chargement, Icone } from "./icones";
import { formaterHorodatage } from "./flux";
import { formaterNombre } from "./logique";
import { Volet } from "./volets";

export type DroitsAtlas = {
  plan: string | null;
  payant: boolean;
  acces_avance: boolean;
  admin_atlas: boolean;
  peut_creer_cles: boolean;
  quota_verification_jour: number;
};

type Verification = {
  siren: string;
  trouvee: boolean;
  nom: string | null;
  active: boolean | null;
  commune: string | null;
  departement: string | null;
  site: string | null;
  a_site: boolean | null;
  email_envoyable: boolean | null;
  telephone_utilisable: boolean | null;
  contactable: boolean;
};
type Resultat = {
  entreprises: Verification[];
  resume: { demandees: number; trouvees: number; avec_site: number; email_envoyable: number; contactables: number };
  invalides?: string[];
  quota_restant_aujourdhui: number;
};

const oui = (v: boolean | null) => (v === null ? "–" : v ? "Oui" : "Non");

/** Vérifier une liste de SIREN ou SIRET collés : site, email, téléphone, en un tableau. Ouvert à tous, avec quota. */
export function VoletVerifier({ droits, onFiche, onFermer }: { droits: DroitsAtlas | null; onFiche: (siren: string, nom: string) => void; onFermer: () => void }) {
  const [texte, setTexte] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [r, setR] = useState<Resultat | null>(null);
  const morceaux = texte.split(/[\n,;\t]+/).map((x) => x.trim()).filter(Boolean);
  const max = Math.min(200, droits?.quota_verification_jour ?? 50);

  const lancer = async () => {
    setBusy(true);
    setErreur(null);
    try {
      setR(await appeler<Resultat>("verifier_entreprises", { sirens: morceaux.slice(0, 200) }));
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Volet titre="Vérifier une liste" sous={`SIREN ou SIRET, ${formaterNombre(droits?.quota_verification_jour ?? 50)} par jour`} large onFermer={onFermer}>
      <label className="hint" htmlFor="atlas-sirens">
        Collez vos numéros (un par ligne, ou séparés par des virgules). Atlas dit pour chacun : site web, email envoyable, téléphone
        utilisable, et si la fiche est contactable.
      </label>
      <textarea
        id="atlas-sirens"
        className="saisie-liste"
        rows={6}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder={"552 032 534\n54206547900065\n815181847"}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn pri" disabled={busy || morceaux.length === 0} onClick={() => void lancer()}>
          {busy ? "Vérification…" : `Vérifier ${morceaux.length ? formaterNombre(Math.min(morceaux.length, max)) : ""} numéro${morceaux.length > 1 ? "s" : ""}`}
        </button>
        {morceaux.length > max && <span className="hint">Les {formaterNombre(max)} premiers seulement.</span>}
        {r && <span className="hint">Il vous en reste {formaterNombre(r.quota_restant_aujourdhui)} aujourd&apos;hui.</span>}
      </div>
      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          <span>{erreur}</span>
        </p>
      )}
      {r && (
        <>
          <p className="callout">
            {formaterNombre(r.resume.trouvees)} trouvées sur {formaterNombre(r.resume.demandees)} · {formaterNombre(r.resume.avec_site)} avec un site ·{" "}
            {formaterNombre(r.resume.email_envoyable)} email envoyable · {formaterNombre(r.resume.contactables)} contactables
            {r.invalides?.length ? ` · ${r.invalides.length} numéro${r.invalides.length > 1 ? "s" : ""} non reconnu${r.invalides.length > 1 ? "s" : ""} : ${r.invalides.slice(0, 5).join(", ")}` : ""}
          </p>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>SIREN</th>
                  <th>Entreprise</th>
                  <th>Site web</th>
                  <th>Email envoyable</th>
                  <th>Téléphone utilisable</th>
                  <th>Contactable</th>
                </tr>
              </thead>
              <tbody>
                {r.entreprises.map((e) => (
                  <tr key={e.siren} className={e.trouvee ? "statique" : "statique muet"}>
                    <td className="num">{e.siren}</td>
                    <td>
                      {e.trouvee && e.nom ? (
                        <button type="button" className="lnk" onClick={() => onFiche(e.siren, e.nom!)}>
                          {e.nom}
                        </button>
                      ) : (
                        "Introuvable"
                      )}
                      {e.trouvee && (
                        <small style={{ display: "block", color: "var(--muted)" }}>
                          {[e.commune, e.departement && `(${e.departement})`, e.active === false ? "cessée" : null].filter(Boolean).join(" ")}
                        </small>
                      )}
                    </td>
                    <td>
                      {e.site ? (
                        <a href={/^https?:/.test(e.site) ? e.site : `https://${e.site}`} target="_blank" rel="noopener noreferrer">
                          {e.site}
                        </a>
                      ) : e.a_site ? (
                        "Oui (adresse non publiée)"
                      ) : (
                        oui(e.a_site)
                      )}
                    </td>
                    <td>{oui(e.email_envoyable)}</td>
                    <td>{oui(e.telephone_utilisable)}</td>
                    <td>{e.trouvee ? oui(e.contactable) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Volet>
  );
}

type Cle = { id: string; nom: string; prefixe: string; auteur: string | null; cree_le: string; derniere_utilisation: string | null; revoquee_le: string | null };

/** Accès avancé : clés API de l'espace et, pour un administrateur Atlas, les espaces qui ont l'accès. */
export function VoletAcces({ droits, onFermer }: { droits: DroitsAtlas; onFermer: () => void }) {
  const [cles, setCles] = useState<Cle[] | null>(null);
  const [nom, setNom] = useState("");
  const [nouvelle, setNouvelle] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recharge, setRecharge] = useState(0);
  const [espaces, setEspaces] = useState<{ espace: string; email: string | null }[] | null>(null);
  const [email, setEmail] = useState("");
  const [msgAdmin, setMsgAdmin] = useState<string | null>(null);

  useEffect(() => {
    if (!droits.acces_avance) return;
    const ctl = new AbortController();
    appeler<{ cles: Cle[] }>("lister_cles_api", {}, ctl.signal)
      .then((r) => setCles(r.cles))
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [droits.acces_avance, recharge]);

  useEffect(() => {
    if (!droits.admin_atlas) return;
    const ctl = new AbortController();
    appeler<{ espaces: { espace: string; email: string | null }[] }>("lister_acces_avances", {}, ctl.signal)
      .then((r) => setEspaces(r.espaces))
      .catch((e) => !estAnnulation(e) && setMsgAdmin(texteErreur(e)));
    return () => ctl.abort();
  }, [droits.admin_atlas, recharge]);

  const creer = async () => {
    setErreur(null);
    try {
      const r = await appeler<{ cle: string }>("creer_cle_api", { nom: nom.trim() || "Script" });
      setNouvelle(r.cle);
      setCopie(false);
      setNom("");
      setRecharge((n) => n + 1);
    } catch (e) {
      setErreur(texteErreur(e));
    }
  };
  const revoquer = async (id: string) => {
    try {
      await appeler("revoquer_cle_api", { cle_id: id });
      setRecharge((n) => n + 1);
    } catch (e) {
      setErreur(texteErreur(e));
    }
  };
  const accorder = async (actif: boolean, cible = email) => {
    setMsgAdmin(null);
    try {
      const r = await appeler<{ espace: string; email: string }>("accorder_acces_avance", { email: cible.trim(), actif });
      setMsgAdmin(`${actif ? "Accès avancé donné à" : "Accès avancé retiré à"} ${r.espace} (${r.email}).`);
      setEmail("");
      setRecharge((n) => n + 1);
    } catch (e) {
      setMsgAdmin(texteErreur(e));
    }
  };

  const exemple = `curl -s https://prospection.app.veridian.site/api/atlas/verifier_entreprises \\
  -H "Authorization: Bearer ${nouvelle ?? "atl_…"}" \\
  -H "Content-Type: application/json" \\
  -d '{"sirens": ["552032534"]}'`;

  return (
    <Volet titre="API et accès avancé" sous={droits.acces_avance ? "SQL en lecture sur ODH et clés API" : "Administration"} large onFermer={onFermer}>
      {droits.acces_avance && (
        <>
          <div className="callout">
            Votre espace a l&apos;accès avancé : votre IA peut lire la base ODH en SQL (outils <code>schema_odh</code> et <code>requete_sql</code>), et
            vos scripts appellent tous les outils Atlas avec une clé API, par <code>POST /api/atlas/&lt;outil&gt;</code>.
          </div>
          {erreur && (
            <p className="err" role="alert">
              <Icone nom="alerte" />
              <span>{erreur}</span>
            </p>
          )}
          {nouvelle && (
            <div className="callout" role="status">
              <b>Copiez cette clé maintenant : elle ne sera plus affichée.</b>
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <code style={{ wordBreak: "break-all", flex: 1 }}>{nouvelle}</code>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void navigator.clipboard?.writeText(nouvelle).then(() => setCopie(true), () => setCopie(false))}
                >
                  {copie ? "Copiée" : "Copier"}
                </button>
              </div>
            </div>
          )}
          <div>
            <h4>Clés de l&apos;espace</h4>
            {cles === null ? (
              <Chargement />
            ) : cles.length === 0 ? (
              <p className="hint">Aucune clé pour l&apos;instant.</p>
            ) : (
              <div className="rows">
                {cles.map((c) => (
                  <div key={c.id}>
                    <span>
                      <b>{c.nom}</b> <code>{c.prefixe}…</code>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {c.revoquee_le
                          ? `révoquée le ${formaterHorodatage(c.revoquee_le)}`
                          : `créée le ${formaterHorodatage(c.cree_le)}${c.auteur ? ` par ${c.auteur}` : ""} · ${c.derniere_utilisation ? `utilisée le ${formaterHorodatage(c.derniere_utilisation)}` : "jamais utilisée"}`}
                      </small>
                    </span>
                    {!c.revoquee_le && droits.peut_creer_cles && (
                      <button type="button" className="btn sm" onClick={() => void revoquer(c.id)}>
                        Révoquer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {droits.peut_creer_cles ? (
              <form
                style={{ display: "flex", gap: 8, marginTop: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void creer();
                }}
              >
                <input className="inp" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de la clé (ex. script CRM)" maxLength={80} aria-label="Nom de la nouvelle clé" />
                <button type="submit" className="btn pri">
                  Créer une clé
                </button>
              </form>
            ) : (
              <p className="hint">Seul un administrateur de l&apos;espace crée ou révoque les clés.</p>
            )}
          </div>
          <div>
            <h4>Exemple</h4>
            <pre className="code">{exemple}</pre>
          </div>
        </>
      )}
      {droits.admin_atlas && (
        <div>
          <h4>Administration Atlas : espaces à accès avancé</h4>
          {msgAdmin && <p className="hint">{msgAdmin}</p>}
          {espaces === null ? (
            <Chargement />
          ) : (
            <div className="rows">
              {espaces.map((e) => (
                <div key={`${e.espace}-${e.email}`}>
                  <span>
                    {e.espace} <small style={{ color: "var(--muted)" }}>{e.email}</small>
                  </span>
                  {e.email && (
                    <button type="button" className="btn sm" onClick={() => void accorder(false, e.email!)}>
                      Retirer
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <form
            style={{ display: "flex", gap: 8, marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void accorder(true);
            }}
          >
            <input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="adresse du propriétaire de l'espace" aria-label="Adresse du client" />
            <button type="submit" className="btn pri" disabled={!email.includes("@")}>
              Donner l&apos;accès
            </button>
          </form>
        </div>
      )}
    </Volet>
  );
}
