import { formaterNombre } from "./logique";

export type EtatLiaisons = { crm: boolean; notifuse: boolean; eteintes: ("crm" | "notifuse")[]; payant: boolean; connexion: boolean };
export const LIAISONS_ETEINTES: EtatLiaisons = { crm: false, notifuse: false, eteintes: [], payant: false, connexion: false };

/** Une phrase à la place d'un bouton qui refuserait. */
export function phraseEteintes(e: EtatLiaisons): string | null {
  if (!e.eteintes.length) return null;
  const noms = e.eteintes.map((c) => (c === "crm" ? "le CRM" : "Mail")).join(" et ");
  return `${e.eteintes.length > 1 ? "Les liaisons" : "La liaison"} vers ${noms} ${e.eteintes.length > 1 ? "sont éteintes" : "est éteinte"} dans votre organisation : un propriétaire ou un administrateur peut l${e.eteintes.length > 1 ? "es " : "'"}allumer dans Veridian.`;
}

/** Boutons qui aboutiront pour CETTE fiche : fermée, bloquée ou hors prospection, aucun ; sans email utilisable, pas de Mail. */
export function envoisPossibles(fiche: Record<string, unknown>, etat: EtatLiaisons): { crm: boolean; notifuse: boolean } {
  const contact = (fiche.contact ?? {}) as Record<string, unknown>;
  const blocages = (fiche.qualite as Record<string, unknown> | undefined)?.blocages;
  const bloquee = (Array.isArray(blocages) ? blocages.length > 0 : !!blocages) || "prospectable" in contact;
  return { crm: etat.crm && !bloquee, notifuse: etat.notifuse && !bloquee && (contact.email_envoyable === 1 || contact.email_envoyable === true) };
}

export type PageCrm = { traitees: number; creees: number; completees: number; deja: number; retirees: number; refusees: { siren: string; message: string }[]; total: number; curseur_suivant: string | null };
export type PageMail = { recus: number; crees: number; existants: number; inscrits: number; ecartes: Record<string, number>; declenche: boolean; total: number; retirees: number; curseur_page?: string; curseur_suivant: string | null; quota_restant_aujourdhui?: number };
export type ListeMail = { id: string; nom: string; sequence: boolean };
export type ResultatFicheCrm = { sort: "cree" | "complete" | "deja" | "refuse"; message?: string; url?: string };

export class ErreurLiaison extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly attendre?: number,
  ) {
    super(message);
  }
}

/** Réponse illisible ou réseau coupé : jamais présentée comme un succès. */
export async function appelerLiaison<T>(action: string, corps: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/liaisons/${action}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  } catch {
    throw new ErreurLiaison("Réseau indisponible. Vous pouvez réessayer, rien ne sera créé deux fois.", "reseau");
  }
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !j) {
    throw new ErreurLiaison(typeof j?.error === "string" && j.code ? j.error : res.status === 401 ? "Session expirée : reconnectez-vous." : `Envoi impossible (${res.status}).`, typeof j?.code === "string" ? j.code : `http_${res.status}`, typeof j?.attendre === "number" ? j.attendre : undefined);
  }
  return j as T;
}

export async function lireEtat(signal?: AbortSignal): Promise<EtatLiaisons> {
  try {
    const r = await fetch("/api/liaisons/etat", { credentials: "same-origin", signal });
    return r.ok ? ((await r.json()) as EtatLiaisons) : LIAISONS_ETEINTES;
  } catch {
    return LIAISONS_ETEINTES;
  }
}

export function phraseFicheCrm(r: ResultatFicheCrm): string {
  if (r.sort === "refuse") return r.message || "Refusé par le CRM.";
  if (r.sort === "deja") return "Déjà dans votre CRM.";
  return r.sort === "cree" ? "Société ajoutée à votre CRM." : "Société complétée dans votre CRM.";
}

export type BilanCrm = { traitees: number; creees: number; completees: number; deja: number; retirees: number; refusees: { siren: string; message: string }[] };
export const BILAN_CRM_VIDE: BilanCrm = { traitees: 0, creees: 0, completees: 0, deja: 0, retirees: 0, refusees: [] };
export function cumulerCrm(b: BilanCrm, p: PageCrm): BilanCrm {
  return { traitees: b.traitees + p.traitees, creees: b.creees + p.creees, completees: b.completees + p.completees, deja: b.deja + p.deja, retirees: b.retirees + p.retirees, refusees: [...b.refusees, ...p.refusees] };
}
const n = (v: number, un: string, plusieurs = `${un}s`) => `${formaterNombre(v)} ${v > 1 ? plusieurs : un}`;
export function phrasesCrm(b: BilanCrm): string[] {
  return [
    b.creees && n(b.creees, "société ajoutée", "sociétés ajoutées"),
    b.completees && n(b.completees, "société complétée", "sociétés complétées"),
    b.deja && `${n(b.deja, "société")} déjà dans le CRM`,
    b.retirees && `${n(b.retirees, "société")} qui n'est plus contactable, non envoyée`,
    b.refusees.length && `${n(b.refusees.length, "société refusée", "sociétés refusées")} par le CRM`,
  ].filter((x): x is string => !!x);
}

const MOTIFS: Record<string, string> = {
  unsubscribed: "désinscrits", complained: "plaintes", bounced: "adresses en erreur", duplicate: "doublons", duplicate_email: "même adresse",
  duplicate_siren: "même entreprise", duplicate_domain: "même site", invalid_email: "adresses invalides", existing: "déjà présents",
};
export const motif = (code: string) => MOTIFS[code] ?? code.replace(/_/g, " ");

export type BilanMail = { recus: number; crees: number; existants: number; inscrits: number; retirees: number; ecartes: Record<string, number>; declenche: boolean; total: number };
export const BILAN_MAIL_VIDE: BilanMail = { recus: 0, crees: 0, existants: 0, inscrits: 0, retirees: 0, ecartes: {}, declenche: false, total: 0 };
export function cumulerMail(b: BilanMail, p: PageMail): BilanMail {
  const ecartes = { ...b.ecartes };
  for (const [k, v] of Object.entries(p.ecartes)) ecartes[k] = (ecartes[k] ?? 0) + v;
  return { recus: b.recus + p.recus, crees: b.crees + p.crees, existants: b.existants + p.existants, inscrits: b.inscrits + p.inscrits, retirees: b.retirees + p.retirees, ecartes, declenche: b.declenche || p.declenche, total: p.total };
}
export function phrasesMail(b: BilanMail, simulation: boolean): string[] {
  const ecartes = Object.entries(b.ecartes).map(([k, v]) => `${motif(k)} : ${formaterNombre(v)}`);
  return [
    `${n(b.crees, "nouveau contact", "nouveaux contacts")}${simulation ? " à créer" : b.crees > 1 ? " créés" : " créé"}`,
    b.existants && `${n(b.existants, "contact")} déjà dans Mail, fiche laissée intacte`,
    ecartes.length && `Écartés par Mail (${ecartes.join(", ")})`,
    b.retirees && `${n(b.retirees, "entreprise")} retirée${b.retirees > 1 ? "s" : ""}, plus contactable${b.retirees > 1 ? "s" : ""}`,
  ].filter((x): x is string => !!x);
}

// ---------------------------------------------------------------- rebond silencieux par le Hub

export type Reprise = { type: "fiche"; siren: string; nom: string } | { type: "segment"; segmentId: string; cible: "crm" | "notifuse" };
const CLE = "atlas-liaison-reprise";
const ESSAI = "atlas-liaison-rebond";
const DUREE_MS = 10 * 60_000;

type Memoire = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memoire = (): Memoire | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/** Vrai si le rebond peut partir : un seul par fenêtre de 5 minutes, sinon la boucle tournerait sans fin. */
export function preparerRebond(r: Reprise, m: Memoire | null = memoire(), maintenant = Date.now()): boolean {
  try {
    if (!m || maintenant - Number(m.getItem(ESSAI) ?? 0) < 5 * 60_000) return false;
    m.setItem(ESSAI, String(maintenant));
    m.setItem(CLE, JSON.stringify({ ...r, t: maintenant }));
    return true;
  } catch {
    return false;
  }
}

/** Ce que l'utilisateur faisait avant le rebond : rouvert, jamais envoyé à sa place. */
export function lireReprise(m: Memoire | null = memoire(), maintenant = Date.now()): Reprise | null {
  try {
    const brut = m?.getItem(CLE);
    if (!m || !brut) return null;
    m.removeItem(CLE);
    const r = JSON.parse(brut) as Reprise & { t: number };
    return maintenant - r.t < DUREE_MS ? r : null;
  } catch {
    return null;
  }
}

export const adresseRebond = (hub: string, retour: string) => `${hub}/api/auth/bounce/prepare?next=${encodeURIComponent(retour)}&auto=1`;
