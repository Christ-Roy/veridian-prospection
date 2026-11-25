"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { appeler, estAnnulation, texteErreur } from "./api";
import { lireFichierClients, pourcent } from "./clients-logique";
import { Chargement, Icone } from "./icones";
import { formaterNombre } from "./logique";
import { Volet } from "./volets";

type Resume = { clients: number; maximum: number; ventes: number; montant_total: number; du: string | null; au: string | null; peut_ecrire: boolean; marches: { segment_id: string; nom: string; clients: number; entreprises: number; taux_pct: number | null; conditions_ignorees: number }[] };
type ImportVentes = { ajoutees: number; changees: number; inchangees: number; refusees: number; clients_ajoutes: number; ventes: number; montant_total: number };
type Import = { recus: number; ajoutes: number; deja: number; invalides: number; exemples_invalides: string[]; total: number };

const LOT = 5000;

/** Mes clients : importer un fichier de SIREN ou SIRET, voir sa part de chaque marché. */
export function VoletClients({ onChoisir, onChange, onFermer }: { onChoisir: (segmentId: string) => void; onChange: (clients: number) => void; onFermer: () => void }) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [texte, setTexte] = useState("");
  const [fichier, setFichier] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);
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

  const { numeros, colonne, ecartes, ventes, colonneMontant, ventesEcartees } = useMemo(() => lireFichierClients(texte), [texte]);
  const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const charger = async (f: File | undefined) => {
    if (!f) return;
    setErreur(null);
    setFait(null);
    if (f.size > 10_000_000) return setErreur("Fichier trop lourd : 10 Mo au plus.");
    if (/\.xlsx?$/i.test(f.name)) return setErreur("Enregistrez d'abord votre tableau en CSV (Fichier, Enregistrer sous, CSV).");
    const octets = await f.arrayBuffer();
    let t = new TextDecoder("utf-8").decode(octets);
    if (t.includes("\uFFFD")) t = new TextDecoder("windows-1252").decode(octets);
    setTexte(t);
    setFichier(f.name);
  };
  const importer = async () => {
    setBusy(true);
    setErreur(null);
    try {
      if (ventes) {
        const v = { ajoutees: 0, changees: 0, inchangees: 0, clients_ajoutes: 0, total: 0, montant: 0 };
        for (let i = 0; i < ventes.length; i += LOT) {
          const r = await appeler<ImportVentes>("importer_ventes", { ventes: ventes.slice(i, i + LOT) });
          v.ajoutees += r.ajoutees;
          v.changees += r.changees;
          v.inchangees += r.inchangees;
          v.clients_ajoutes += r.clients_ajoutes;
          v.total = r.ventes;
          v.montant = r.montant_total;
        }
        setFait(`${formaterNombre(v.ajoutees)} vente${v.ajoutees > 1 ? "s" : ""} ajoutée${v.ajoutees > 1 ? "s" : ""}${v.changees ? `, ${formaterNombre(v.changees)} corrigée${v.changees > 1 ? "s" : ""}` : ""}${v.inchangees ? `, ${formaterNombre(v.inchangees)} déjà là` : ""}, ${formaterNombre(v.clients_ajoutes)} nouveau${v.clients_ajoutes > 1 ? "x" : ""} client${v.clients_ajoutes > 1 ? "s" : ""}. ${formaterNombre(v.total)} ventes en tout, ${euros(v.montant)}.`);
        setTexte("");
        setFichier(null);
        await lire();
        return;
      }
      const somme: Import = { recus: 0, ajoutes: 0, deja: 0, invalides: 0, exemples_invalides: [], total: 0 };
      for (let i = 0; i < numeros.length; i += LOT) {
        const r = await appeler<Import>("importer_clients", { numeros: numeros.slice(i, i + LOT) });
        somme.recus += r.recus;
        somme.ajoutes += r.ajoutes;
        somme.deja += r.deja;
        somme.total = r.total;
      }
      setFait(`${formaterNombre(somme.ajoutes)} ajouté${somme.ajoutes > 1 ? "s" : ""}${somme.deja ? `, ${formaterNombre(somme.deja)} déjà là` : ""}. ${formaterNombre(somme.total)} clients en tout.`);
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
    if (!window.confirm(`Retirer les ${formaterNombre(resume?.clients ?? 0)} clients importés et leurs ventes ? Vos marchés ne changent pas.`)) return;
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
        client » les écarte de vos cibles. Un fichier de ventes (avec une colonne de montant, et si possible de date et de facture) sert aussi à
        proposer des règles de priorité. On garde le numéro, le montant, la date et la référence, rien d&apos;autre.
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
              {ventes
                ? `${formaterNombre(ventes.length)} vente${ventes.length > 1 ? "s" : ""} lue${ventes.length > 1 ? "s" : ""}, ${euros(ventes.reduce((a, v) => a + v.montant, 0))} (colonne « ${colonneMontant} »), chez ${formaterNombre(numeros.length)} entreprise${numeros.length > 1 ? "s" : ""}${ventesEcartees ? ` · ${formaterNombre(ventesEcartees)} ligne${ventesEcartees > 1 ? "s" : ""} écartée${ventesEcartees > 1 ? "s" : ""} (numéro ou montant illisible)` : ""}`
                : numeros.length
                ? `${formaterNombre(numeros.length)} entreprise${numeros.length > 1 ? "s" : ""} reconnue${numeros.length > 1 ? "s" : ""}${colonne ? ` dans la colonne « ${colonne} »` : ""}${ecartes ? ` · ${formaterNombre(ecartes)} valeur${ecartes > 1 ? "s" : ""} écartée${ecartes > 1 ? "s" : ""} (numéro incomplet ou faux)` : ""}`
                : "Aucun SIREN ni SIRET valide reconnu."}
            </p>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn pri" disabled={busy || !numeros.length} onClick={() => void importer()}>
              {busy ? "Import…" : ventes ? `Importer ${formaterNombre(ventes.length)} vente${ventes.length > 1 ? "s" : ""}` : `Importer ${numeros.length ? formaterNombre(numeros.length) : ""} client${numeros.length > 1 ? "s" : ""}`}
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
          {fait}
        </p>
      )}
      {resume && resume.clients > 0 && (
        <div className="block">
          {resume.ventes > 0 && (
            <p className="hint">
              {formaterNombre(resume.ventes)} ventes, {euros(resume.montant_total)}
              {resume.du ? `, du ${new Date(resume.du).toLocaleDateString("fr-FR")} au ${new Date(resume.au!).toLocaleDateString("fr-FR")}` : ""}.
            </p>
          )}
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
