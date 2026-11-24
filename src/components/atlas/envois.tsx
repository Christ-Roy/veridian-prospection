"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Icone } from "./icones";
import {
  adresseRebond, appelerLiaison, BILAN_CRM_VIDE, BILAN_MAIL_VIDE, cumulerCrm, cumulerMail, ErreurLiaison, phraseFicheCrm, phrasesCrm, phrasesMail, preparerRebond,
  type BilanCrm, type BilanMail, type EtatLiaisons, type PageCrm, type PageMail, type Reprise, type ResultatFicheCrm,
} from "./liaisons-logique";
import { formaterNombre } from "./logique";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";
const geste = () => crypto.randomUUID();

/** Erreur lisible ; `rebond` repasse une fois par le Hub, puis l'écran rouvre ce qu'on faisait. */
function useErreur(reprise: Reprise) {
  const [erreur, setErreur] = useState<ErreurLiaison | null>(null);
  const r = useRef(reprise);
  useEffect(() => {
    r.current = reprise;
  });
  const traiter = useCallback((e: unknown) => {
    const x = e instanceof ErreurLiaison ? e : new ErreurLiaison("Erreur inattendue. Réessayez, rien ne sera créé deux fois.", "erreur");
    if (x.code === "rebond") {
      if (preparerRebond(r.current)) {
        window.location.assign(adresseRebond(HUB, window.location.href));
        return;
      }
      setErreur(new ErreurLiaison("Votre connexion Veridian n'a pas pu être renouvelée : rouvrez Atlas depuis votre espace Veridian.", "rebond_echoue"));
      return;
    }
    setErreur(x);
  }, []);
  return { erreur, setErreur, traiter };
}

function MessageErreur({ erreur }: { erreur: ErreurLiaison | null }) {
  if (!erreur) return null;
  const lien = erreur.code === "plan" ? { href: `${HUB}/dashboard/billing`, texte: "Voir les plans" } : ["paire_eteinte", "app_non_ouverte", "cible_non_reliee", "cible_non_membre", "rebond_echoue", "autre_espace"].includes(erreur.code) ? { href: `${HUB}/dashboard`, texte: "Ouvrir Veridian" } : null;
  return (
    <div className="err" role="alert">
      <Icone nom="alerte" />
      <span>
        {erreur.message}
        {lien && (
          <>
            {" "}
            <a className="lnk" href={lien.href} target="_blank" rel="noopener noreferrer">
              {lien.texte}
            </a>
          </>
        )}
      </span>
    </div>
  );
}

const PLAN = new ErreurLiaison("L'envoi vers une autre application est réservé aux plans payants Veridian, comme l'export.", "plan");

// ---------------------------------------------------------------- fiche

export function EnvoisFiche({ siren, nom, etat }: { siren: string; nom: string; etat: EtatLiaisons }) {
  const { erreur, setErreur, traiter } = useErreur({ type: "fiche", siren, nom });
  const [envoi, setEnvoi] = useState(false);
  const [fait, setFait] = useState<ResultatFicheCrm | null>(null);
  const [mail, setMail] = useState(false);
  // Le même identifiant tant que l'envoi n'a pas abouti : un nouvel essai n'est pas un nouveau geste.
  const id = useRef(geste());
  useEffect(() => {
    id.current = geste();
    setFait(null);
    setErreur(null);
  }, [siren, setErreur]);

  const versCrm = async () => {
    if (!etat.payant) return setErreur(PLAN);
    setEnvoi(true);
    setErreur(null);
    setFait(null);
    try {
      const r = await appelerLiaison<ResultatFicheCrm>("crm-fiche", { geste: id.current, siren });
      setFait(r);
      id.current = geste();
    } catch (e) {
      traiter(e);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <>
      {etat.crm && (
        <button type="button" className="btn" onClick={() => void versCrm()} disabled={envoi}>
          <Icone nom="ent" />
          {envoi ? "Envoi…" : "Envoyer au CRM"}
        </button>
      )}
      {etat.notifuse && (
        <button type="button" className="btn" onClick={() => (etat.payant ? setMail(true) : setErreur(PLAN))}>
          <Icone nom="envoi" />
          Envoyer vers Mail
        </button>
      )}
      {fait && (
        <p className="hint" role="status">
          {phraseFicheCrm(fait)}{" "}
          {fait.url && (
            <a className="lnk" href={fait.url} target="_blank" rel="noopener noreferrer">
              Ouvrir dans le CRM
            </a>
          )}
        </p>
      )}
      <MessageErreur erreur={erreur} />
      {mail && <DialogueMail objet={{ type: "fiche", siren, nom }} onFermer={() => setMail(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- cadre de dialogue

function Cadre({ titre, occupe, onFermer, children }: { titre: string; occupe: boolean; onFermer: () => void; children: ReactNode }) {
  const boite = useRef<HTMLDivElement>(null);
  const fermer = useRef(onFermer);
  const enCours = useRef(occupe);
  useEffect(() => {
    fermer.current = onFermer;
    enCours.current = occupe;
  });
  useEffect(() => {
    const avant = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boite.current?.focus();
    // En capture : le volet dessous ferme aussi sur Échap.
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!enCours.current) fermer.current();
    };
    document.addEventListener("keydown", echap, true);
    return () => {
      document.removeEventListener("keydown", echap, true);
      avant?.focus();
    };
  }, []);
  return (
    <div className="dlg" onMouseDown={(e) => e.target === e.currentTarget && !occupe && onFermer()}>
      <div className="dlg-box" role="dialog" aria-modal="true" aria-label={titre} tabIndex={-1} ref={boite}>
        <h2>{titre}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- segment vers le CRM

const MAX_CRM = 100;

export function DialogueCrm({ segmentId, nom, payant, onFermer }: { segmentId: string; nom: string; payant: boolean; onFermer: () => void }) {
  const { erreur, setErreur, traiter } = useErreur({ type: "segment", segmentId, cible: "crm" });
  const [envoi, setEnvoi] = useState(false);
  const [bilan, setBilan] = useState<BilanCrm>(BILAN_CRM_VIDE);
  const [suite, setSuite] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const arret = useRef(false);
  const id = useRef(geste());
  const duGeste = useRef(0);
  useEffect(
    () => () => {
      arret.current = true;
    },
    [],
  );
  const fini = total !== null && suite === null && !erreur;

  const envoyer = async () => {
    if (!payant) return setErreur(PLAN);
    setEnvoi(true);
    setErreur(null);
    arret.current = false;
    try {
      let curseur = suite;
      do {
        const p: PageCrm = await appelerLiaison<PageCrm>("crm-segment", { geste: id.current, segmentId, curseur });
        curseur = p.curseur_suivant;
        duGeste.current += p.traitees + p.retirees;
        setBilan((b) => cumulerCrm(b, p));
        setTotal(p.total);
        setSuite(curseur);
      } while (curseur && duGeste.current < MAX_CRM && !arret.current);
      id.current = geste();
      duGeste.current = 0;
    } catch (e) {
      traiter(e);
    } finally {
      setEnvoi(false);
    }
  };

  const phrases = phrasesCrm(bilan);
  return (
    <Cadre titre="Envoyer au CRM" occupe={envoi} onFermer={onFermer}>
      <p>
        Les {MAX_CRM} premières entreprises de « {nom} », par priorité : une société, un contact et une tâche d&apos;appel chacune. Rien de ce que vous avez déjà saisi dans le CRM n&apos;est remplacé.
      </p>
      {phrases.length > 0 && (
        <ul className="bilan" role="status">
          {phrases.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {bilan.refusees.slice(0, 3).map((r) => (
        <p key={r.siren}>
          SIREN {r.siren} : {r.message}
        </p>
      ))}
      {envoi && (
        <p role="status">
          {formaterNombre(bilan.traitees)} traitée{bilan.traitees > 1 ? "s" : ""}…
        </p>
      )}
      <MessageErreur erreur={erreur} />
      <div className="row">
        {envoi ? (
          <button type="button" className="btn" onClick={() => (arret.current = true)}>
            Arrêter
          </button>
        ) : (
          <button type="button" className="btn" onClick={onFermer}>
            Fermer
          </button>
        )}
        {!fini && (
          <button type="button" className="btn pri" disabled={envoi} onClick={() => void envoyer()}>
            {envoi ? "Envoi…" : erreur && total !== null ? "Reprendre" : suite ? "Envoyer la suite" : "Envoyer"}
          </button>
        )}
      </div>
    </Cadre>
  );
}

// ---------------------------------------------------------------- vers Mail

type ObjetMail = { type: "fiche"; siren: string; nom: string } | { type: "segment"; segmentId: string; nom: string; payant: boolean };
const NOUVELLE = "__nouvelle";

export function DialogueMail({ objet, onFermer }: { objet: ObjetMail; onFermer: () => void }) {
  const { erreur, setErreur, traiter } = useErreur(objet.type === "fiche" ? { type: "fiche", siren: objet.siren, nom: objet.nom } : { type: "segment", segmentId: objet.segmentId, cible: "notifuse" });
  const payant = objet.type === "fiche" || objet.payant;
  const [listes, setListes] = useState<{ id: string; nom: string }[] | null>(null);
  const [liste, setListe] = useState("");
  const [nouvelle, setNouvelle] = useState("");
  const [etape, setEtape] = useState<"choix" | "simulation" | "simule" | "import" | "fait">("choix");
  // Le bilan simulé reste affiché tant qu'aucune page n'est importée : une panne au premier essai n'efface rien.
  const [simule, setSimule] = useState<BilanMail>(BILAN_MAIL_VIDE);
  const [importe, setImporte] = useState<BilanMail | null>(null);
  const bilan = importe ?? simule;
  const id = useRef(geste());
  const pages = useRef<(string | null)[]>([]);
  const faites = useRef(0);
  const vivant = useRef(true);
  useEffect(() => {
    vivant.current = true;
    if (!payant) setErreur(PLAN);
    else
      appelerLiaison<{ listes: { id: string; nom: string }[] }>("mail-listes", {})
        .then((r) => vivant.current && (setListes(r.listes), setListe((x) => x || (r.listes.length ? "" : NOUVELLE))))
        .catch((e) => vivant.current && traiter(e));
    return () => {
      vivant.current = false;
    };
  }, [payant, setErreur, traiter]);

  const occupe = etape === "simulation" || etape === "import";
  const page = (curseur: string | null, listeId: string, simulation: boolean) =>
    objet.type === "fiche"
      ? appelerLiaison<PageMail>("mail-fiche", { geste: id.current, siren: objet.siren, listeId, simulation })
      : appelerLiaison<PageMail>("mail-segment", { geste: id.current, segmentId: objet.segmentId, listeId, curseur, simulation });

  const simuler = async () => {
    setErreur(null);
    setEtape("simulation");
    setSimule(BILAN_MAIL_VIDE);
    setImporte(null);
    pages.current = [];
    faites.current = 0;
    try {
      let cible = liste;
      if (cible === NOUVELLE) {
        const l = await appelerLiaison<{ id: string; nom: string }>("mail-creer-liste", { geste: id.current, nom: nouvelle.trim() });
        cible = l.id;
        setListes((x) => [...(x ?? []).filter((y) => y.id !== l.id), l]);
        setListe(l.id);
      }
      let curseur: string | null = null;
      do {
        const p: PageMail = await page(curseur, cible, true);
        pages.current.push(p.curseur_page ?? null);
        setSimule((b) => cumulerMail(b, p));
        curseur = p.curseur_suivant;
      } while (curseur && vivant.current);
      if (vivant.current) setEtape("simule");
    } catch (e) {
      traiter(e);
      setEtape("choix");
    }
  };

  const importer = async () => {
    setErreur(null);
    setEtape("import");
    try {
      // Reprend à la première page non aboutie : une page déjà importée n'est ni renvoyée ni recomptée.
      while (faites.current < pages.current.length) {
        const p = await page(pages.current[faites.current], liste, false);
        faites.current += 1;
        setImporte((b) => cumulerMail(b ?? BILAN_MAIL_VIDE, p));
      }
      setEtape("fait");
    } catch (e) {
      traiter(e);
      setEtape("simule");
    }
  };

  const changer = () => {
    id.current = geste();
    setEtape("choix");
    setSimule(BILAN_MAIL_VIDE);
  };
  const pret = liste === NOUVELLE ? nouvelle.trim().length > 0 : !!liste;
  return (
    <Cadre titre="Envoyer vers Mail" occupe={occupe} onFermer={onFermer}>
      <p>
        « {objet.nom} » s&apos;ajoute à une liste de Mail. <b>Aucun mail ne part</b> : les désinscrits, plaintes et adresses en erreur restent exclus, et 5 000 contacts au plus sortent par jour.
      </p>
      {payant && !listes && !erreur && <p role="status">Lecture de vos listes…</p>}
      {listes && (
        <>
          <label>
            Liste
            <select value={liste} disabled={etape !== "choix"} onChange={(e) => setListe(e.target.value)}>
              <option value="" disabled>
                Choisir une liste
              </option>
              {listes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nom}
                </option>
              ))}
              <option value={NOUVELLE}>Nouvelle liste…</option>
            </select>
          </label>
          {liste === NOUVELLE && (
            <label>
              Nom de la liste
              <input type="text" value={nouvelle} maxLength={100} disabled={etape !== "choix"} onChange={(e) => setNouvelle(e.target.value)} />
            </label>
          )}
        </>
      )}
      {(etape !== "choix" || bilan.recus > 0) && (
        <ul className="bilan" role="status">
          {phrasesMail(bilan, !importe).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {etape === "simule" && bilan.declenche && <p role="alert">Cette liste démarre une séquence : choisissez-en une autre.</p>}
      {etape === "fait" && <p role="status">C&apos;est dans votre liste. Aucun mail n&apos;est parti.</p>}
      <MessageErreur erreur={erreur} />
      <div className="row">
        <button type="button" className="btn" disabled={occupe} onClick={onFermer}>
          {etape === "fait" ? "Fermer" : "Annuler"}
        </button>
        {etape === "simule" && !importe && (
          <button type="button" className="btn" onClick={changer}>
            Changer de liste
          </button>
        )}
        {(etape === "choix" || etape === "simulation") && listes && (
          <button type="button" className="btn pri" disabled={!pret || occupe} onClick={() => void simuler()}>
            {etape === "simulation" ? "Simulation…" : "Simuler"}
          </button>
        )}
        {(etape === "simule" || etape === "import") && !bilan.declenche && (
          <button type="button" className="btn pri" disabled={occupe || simule.recus === 0} onClick={() => void importer()}>
            {etape === "import" ? "Ajout…" : importe ? "Reprendre" : "Confirmer l'ajout"}
          </button>
        )}
      </div>
    </Cadre>
  );
}
