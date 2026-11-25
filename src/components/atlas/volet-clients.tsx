"use client";

import { useCallback, useEffect, useState } from "react";

import { appeler, estAnnulation, texteErreur } from "./api";
import { lireFichierClients, pourcent } from "./clients-logique";
import { Chargement, Icone } from "./icones";
import { formaterNombre } from "./logique";
import { Volet } from "./volets";

type Resume = { clients: number; maximum: number; peut_ecrire: boolean; marches: { segment_id: string; nom: string; clients: number; entreprises: number; taux_pct: number | null; conditions_ignorees: number }[] };
type Import = { recus: number; ajoutes: number; deja: number; invalides: number; exemples_invalides: string[]; total: number };

const LOT = 5000;

/** Mes clients : importer un fichier de SIREN ou SIRET, voir sa part de chaque marché. */
export function VoletClients({ onChoisir, onChange, onFermer }: { onChoisir: (segmentId: string) => void; onChange: (clients: number) => void; onFermer: () => void }) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [texte, setTexte] = useState("");
  const [fichier, setFichier] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<Import | null>(null);
  const lire = useCallback(
    (signal?: AbortSignal) =>
      appeler<Resume>("clients_resume", {}, signal).then((r) => {
        setResume(r);
        onChange(r.clients);
      }),
    [onChange],
  );
  useEffect(() => {
    const ctl = new AbortController();
    lire(ctl.signal).catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [lire]);

  const { numeros, colonne, ecartes } = lireFichierClients(texte);
  const charger = async (f: File | undefined) => {
    if (!f) return;
    setErreur(null);
    setFait(null);
    if (f.size > 10_000_000) return setErreur("Fichier trop lourd : 10 Mo au plus.");
    if (/\.xlsx?$/i.test(f.name)) return setErreur("Enregistrez d'abord votre tableau en CSV (Fichier, Enregistrer sous, CSV).");
    const octets = await f.arrayBuffer();
    let t = new TextDecoder("utf-8").decode(octets);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(octets);
    setTexte(t);
    setFichier(f.name);
  };
  const importer = async () => {
    setBusy(true);
    setErreur(null);
    try {
      const somme: Import = { recus: 0, ajoutes: 0, deja: 0, invalides: 0, exemples_invalides: [], total: 0 };
      for (let i = 0; i < numeros.length; i += LOT) {
        const r = await appeler<Import>("importer_clients", { numeros: numeros.slice(i, i + LOT) });
        somme.recus += r.recus;
        somme.ajoutes += r.ajoutes;
        somme.deja += r.deja;
        somme.total = r.total;
      }
      setFait(somme);
      setTexte("");
      setFichier(null);
      await lire();
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setBusy(false);
    }
  };
  const vider = async () => {
    if (!window.confirm(`Retirer les ${formaterNombre(resume?.clients ?? 0)} clients importés ? Vos marchés ne changent pas.`)) return;
    try {
      await appeler("retirer_clients", { tous: true });
      setFait(null);
      await lire();
    } catch (e) {
      setErreur(texteErreur(e));
    }
  };
  const max = Math.max(0.0001, ...(resume?.marches ?? []).map((m) => m.taux_pct ?? 0));

  return (
    <Volet titre="Mes clients" sous={resume ? `${formaterNombre(resume.clients)} client${resume.clients > 1 ? "s" : ""} importé${resume.clients > 1 ? "s" : ""}` : undefined} large onFermer={onFermer}>
      <p className="hint">
        Importez vos clients par SIREN ou SIRET : Atlas mesure votre part de chaque marché, les signale dans les listes, et le filtre « Est déjà
        client » les écarte de vos cibles. Seul le numéro est gardé.
      </p>
      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          <span>{erreur}</span>
        </p>
      )}
      {!resume && !erreur && <Chargement />}
      {resume?.peut_ecrire && (
        <>
          <label className="btn" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
            <Icone nom="tableau" />
            {fichier ?? "Choisir un fichier CSV"}
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => (void charger(e.target.files?.[0]), (e.target.value = ""))} />
          </label>
          {!fichier && <textarea className="saisie-liste" rows={4} aria-label="Ou collez vos numéros" value={texte} onChange={(e) => (setTexte(e.target.value), setFait(null))} placeholder={"Ou collez vos SIREN ou SIRET, un par ligne"} />}
          {texte && (
            <p className="callout">
              {numeros.length
                ? `${formaterNombre(numeros.length)} entreprise${numeros.length > 1 ? "s" : ""} reconnue${numeros.length > 1 ? "s" : ""}${colonne ? ` dans la colonne « ${colonne} »` : ""}${ecartes ? ` · ${formaterNombre(ecartes)} valeur${ecartes > 1 ? "s" : ""} écartée${ecartes > 1 ? "s" : ""} (numéro incomplet ou faux)` : ""}`
                : "Aucun SIREN ni SIRET valide reconnu."}
            </p>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn pri" disabled={busy || !numeros.length} onClick={() => void importer()}>
              {busy ? "Import…" : `Importer ${numeros.length ? formaterNombre(numeros.length) : ""} client${numeros.length > 1 ? "s" : ""}`}
            </button>
            {texte && !busy && (
              <button type="button" className="btn ghost" onClick={() => (setTexte(""), setFichier(null))}>
                Annuler
              </button>
            )}
            {!texte && resume.clients > 0 && (
              <button type="button" className="btn ghost" onClick={() => void vider()}>
                Tout retirer
              </button>
            )}
          </div>
        </>
      )}
      {fait && (
        <p className="callout" role="status">
          {formaterNombre(fait.ajoutes)} ajouté{fait.ajoutes > 1 ? "s" : ""}
          {fait.deja ? `, ${formaterNombre(fait.deja)} déjà là` : ""}. {formaterNombre(fait.total)} clients en tout.
        </p>
      )}
      {resume && resume.clients > 0 && (
        <div className="block">
          <h3>Part de vos marchés</h3>
          {resume.marches.length === 0 && <p className="empty">Créez un marché pour voir votre part.</p>}
          <div className="hbars">
            {resume.marches.map((m) => (
              <button type="button" className="hb lien" key={m.segment_id} title={`${formaterNombre(m.clients)} clients sur ${formaterNombre(m.entreprises)} entreprises${m.conditions_ignorees ? `, ${m.conditions_ignorees} filtre(s) hors du calcul` : ""}`} onClick={() => onChoisir(m.segment_id)}>
                <span>{m.nom}</span>
                <span className="t">
                  <i style={{ width: `${((m.taux_pct ?? 0) * 100) / max}%`, background: "var(--blue)" }} />
                </span>
                <span className="v num">
                  {pourcent(m.taux_pct)} <small>({formaterNombre(m.clients)})</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Volet>
  );
}
