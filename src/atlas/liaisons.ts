/**
 * « Envoyer au CRM » et « Envoyer vers Mail » (VER-246, F1 et F2 d'INTEGRATIONS-NATIVES). Un humain clique, Atlas demande
 * un jeton au Hub et appelle l'app cible directement. Aucun mail ne part d'ici : Mail reçoit des contacts dans une liste.
 *
 * Mêmes plafonds que l'extraction (extraction.ts) : plan payant, 5 000 lignes par jour et par espace, tracées. Les
 * coordonnées passent à la cible, jamais à l'écran : seuls des comptes reviennent.
 */
import { createHash, randomUUID } from "node:crypto";

import type { UserContext } from "@/lib/auth/user-context";
import { appelerCrm, appelerMail } from "@/lib/liaisons/action";
import { liaisonOuverte } from "@/lib/liaisons/drapeau";
import { uneFois } from "@/lib/liaisons/envois";
import { RefusLiaison, type Cible } from "@/lib/liaisons/erreurs";
import { demanderJeton } from "@/lib/liaisons/hub";
import { oublierPoignee, poigneeDe } from "@/lib/liaisons/poignee";
import { prisma } from "@/lib/prisma";

import { peutExporter } from "./export";
import { decoderCurseur, extraireSegment, reserverFiche } from "./extraction";
import * as seg from "./segments";
import { sourceMarche, type LigneCrm, type LigneExtraite } from "./source";

export const PAGE_MAIL = 1000;
/** Lot accepté par le CRM (plugin liaisons 0.4) : un jeton et un appel par lot, et au plus 100 sociétés par geste. */
export const PAGE_CRM = 20;
export const MAX_CRM_PAR_GESTE = 100;

export type Appel = { ctx: UserContext; sessionId: string | null; hubTenantId: string | null; payant: boolean };

const peutEcrire = (ctx: UserContext) => ctx.isAdmin || ctx.workspaces.some((w) => w.role !== "viewer");

export async function appelDe(ctx: UserContext, sessionId: string | null): Promise<Appel> {
  const t = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { plan: true, hubTenantId: true } });
  return { ctx, sessionId, hubTenantId: t?.hubTenantId ?? null, payant: peutExporter(t?.plan) };
}

/** Ce que l'écran peut montrer. Un bouton n'apparaît que si la liaison est ouverte ici et que l'utilisateur peut écrire. */
export async function etatLiaisons(a: Appel) {
  const permis = peutEcrire(a.ctx);
  const crm = permis && liaisonOuverte("crm", a.hubTenantId);
  const notifuse = permis && liaisonOuverte("notifuse", a.hubTenantId);
  const connexion = (crm || notifuse) && !!(await poigneeDe(a.sessionId, a.ctx.userId, a.hubTenantId!));
  return { crm, notifuse, payant: a.payant, connexion };
}

type Pret = { hubTenantId: string; poignee: string; sessionId: string | null };
async function preparer(a: Appel, cible: Cible): Promise<Pret> {
  if (!liaisonOuverte(cible, a.hubTenantId)) throw new RefusLiaison("eteinte", "Cet envoi n'est pas disponible sur votre espace.", 404);
  if (!peutEcrire(a.ctx)) throw new RefusLiaison("lecture_seule", "Votre rôle est en lecture seule sur cet espace.", 403);
  if (!a.payant) throw new RefusLiaison("plan", "L'envoi vers une autre application est réservé aux plans payants Veridian, comme l'export.", 402);
  const poignee = await poigneeDe(a.sessionId, a.ctx.userId, a.hubTenantId!);
  if (!poignee) throw new RefusLiaison("rebond", "Votre connexion Veridian doit être renouvelée avant cet envoi.", 401);
  return { hubTenantId: a.hubTenantId!, poignee, sessionId: a.sessionId };
}

async function jeton(p: Pret, cible: Cible, motif: string) {
  try {
    return await demanderJeton({ poignee: p.poignee, hubTenantId: p.hubTenantId, cible, motif });
  } catch (e) {
    if (e instanceof RefusLiaison && e.code === "rebond" && p.sessionId) await oublierPoignee(p.sessionId, p.hubTenantId).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------- mise en forme

const PAS_UNE_PERSONNE = /\b(holding|associes|groupe|group|invest|finance|participations?|sarl|sas|sasu|sci|eurl|gmbh|ltd|societe|cie)\b/i;

/** « CAROLE GABARROCA » → prénom et nom. Tout autre cas (société présidente, trois mots) reste en un seul nom : on ne devine pas. */
export function personne(dirigeant: string | null): { prenom?: string; nom?: string } {
  const n = dirigeant?.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (!n || PAS_UNE_PERSONNE.test(n)) return {};
  const [prenom, nom, ...reste] = n.split(" ");
  return nom && !reste.length ? { prenom, nom } : { nom: n };
}

const sansVides = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));

export function envoiCrm(l: LigneCrm | LigneExtraite): Record<string, unknown> {
  const p = personne(l.dirigeant);
  const contact = sansVides({ ...p, email: l.email, telephone: l.telephone, poste: p.nom ? l.role_dirigeant : null });
  const note = [
    l.activite && `Activité : ${l.activite}${l.naf ? ` (${l.naf})` : ""}`,
    l.telephone && `Téléphone : ${l.telephone}`,
    l.dirigeant && `Dirigeant : ${l.dirigeant}${l.role_dirigeant ? `, ${l.role_dirigeant}` : ""}`,
    "Envoyé depuis Veridian Atlas.",
  ].filter(Boolean);
  return {
    siren: l.siren,
    societe: sansVides({ nom: l.raison_sociale || `SIREN ${l.siren}`, domaine: l.domaine, codePostal: l.code_postal, ville: l.commune }),
    ...(contact.email || contact.nom ? { contact } : {}),
    tache: { note: note.join("\n") },
  };
}

export function contactMail(l: LigneExtraite, origine: string): Record<string, unknown> {
  const p = personne(l.dirigeant);
  return sansVides({
    email: l.email, first_name: p.prenom, last_name: p.nom, phone: l.telephone, job_title: p.nom ? l.role_dirigeant : null,
    siren: l.siren, domaine: l.domaine, raison_sociale: l.raison_sociale, activite: l.activite, naf: l.naf,
    code_postal: l.code_postal, ville: l.commune, departement: l.departement, source: "Veridian Atlas", segment_atlas: origine,
  });
}

// ---------------------------------------------------------------- vers le CRM

type SortCrm = { siren: string; sort: "cree" | "complete" | "deja" | "refuse"; message?: string; url?: string };

/** Un refus de droits, de jeton ou de rôle vaut pour tout l'envoi ; les autres sont propres à une société (corbeille, donnée). */
const REFUS_GENERAUX = ["droits", "act_requis", "membre_requis", "lot_invalide"];
const A_REPRENDRE = ["non_traite", "echec"];
const message = (r: Record<string, unknown>) => (typeof r.message === "string" ? r.message.slice(0, 300) : "Refusé par le CRM.");

function sortCrm(siren: string, r: Record<string, unknown>): SortCrm {
  if (r.ok !== true) {
    if (REFUS_GENERAUX.includes(String(r.erreur))) throw new RefusLiaison("cible_droits", message(r), 403);
    return { siren, sort: "refuse", message: message(r) };
  }
  const societe = (r.societe ?? {}) as { etat?: string; url?: unknown };
  const url = typeof societe.url === "string" && /^https:\/\/[a-z0-9.-]+\.veridian\.site\//.test(societe.url) ? societe.url : undefined;
  return { siren, sort: r.rejoue === true ? "deja" : societe.etat === "creee" ? "cree" : "complete", ...(url ? { url } : {}) };
}

async function lotPourCrm(p: Pret, lignes: readonly LigneExtraite[], cle: string): Promise<SortCrm[]> {
  if (!lignes.length) return [];
  const r = await appelerCrm(await jeton(p, "crm", "segment.envoyer_au_crm"), "app_envoyer_au_crm", { envois: lignes.map(envoiCrm) }, cle, { delaiMs: 110_000 });
  if (!Array.isArray(r.resultats)) {
    sortCrm("", r); // refus de tout le lot : lève s'il est général
    throw new RefusLiaison("reponse_invalide", `Le CRM n'a pas traité ce lot : ${message(r)}`, 502);
  }
  // Par SIREN, jamais par position seule : une réponse incomplète ou mélangée ne se lit pas comme un succès.
  const par = new Map((r.resultats as Record<string, unknown>[]).map((x) => [String(x?.siren ?? ""), x]));
  const reste = lignes.filter((l) => A_REPRENDRE.includes(String(par.get(l.siren)?.erreur)) || !par.has(l.siren));
  // La page entière échoue et se reprend : ce qui est déjà créé sera rendu « déjà dans le CRM ».
  if (reste.length) throw new RefusLiaison("a_reprendre", `Le CRM n'a pas eu le temps de tout traiter (${reste.length} restante${reste.length > 1 ? "s" : ""}). Reprenez, rien ne sera créé deux fois.`, 503, 5);
  return lignes.map((l) => sortCrm(l.siren, par.get(l.siren)!));
}

export async function ficheVersCrm(a: Appel, e: { geste: string; siren: string }) {
  const p = await preparer(a, "crm");
  const l = await sourceMarche().pourCrm(e.siren);
  if (!l) throw new RefusLiaison("non_prospectable", "Cette entreprise ne se prospecte pas (fermée, en diffusion limitée ou bloquée).", 409);
  return uneFois({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, geste: e.geste, etape: "fiche", cible: "crm", reference: e.siren }, async (id) => {
    await reserverFiche({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, client: null, canal: "liaison" }, "crm", id);
    return sortCrm(l.siren, await appelerCrm(await jeton(p, "crm", "bouton.envoyer_au_crm"), "app_envoyer_au_crm", envoiCrm(l), `${e.geste}:${e.siren}`));
  });
}

export async function segmentVersCrm(a: Appel, e: { geste: string; segmentId: string; curseur?: string | null }) {
  const p = await preparer(a, "crm");
  const debut = (e.curseur && decoderCurseur(e.curseur)?.debut) || 0;
  const faites = await prisma.atlasEnvoi.count({ where: { tenantId: a.ctx.tenantId, geste: e.geste, NOT: { etape: `crm:${debut}` } } });
  if (faites * PAGE_CRM >= MAX_CRM_PAR_GESTE) throw new RefusLiaison("lot_plein", `${MAX_CRM_PAR_GESTE} sociétés au plus par envoi : relancez pour la suite.`, 409);
  return uneFois({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, geste: e.geste, etape: `crm:${debut}`, cible: "crm", reference: e.segmentId }, async () => {
    const page = await extraireSegment({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, client: null, canal: "liaison" }, { segmentId: e.segmentId, curseur: e.curseur, limite: PAGE_CRM });
    const sorts = await lotPourCrm(p, page.lignes, `${e.geste}:crm:${debut}`);
    const n = (s: SortCrm["sort"]) => sorts.filter((x) => x.sort === s).length;
    return {
      traitees: page.lignes.length, creees: n("cree"), completees: n("complete"), deja: n("deja"), retirees: page.retires.length,
      refusees: sorts.filter((x) => x.sort === "refuse").map((x) => ({ siren: x.siren, message: x.message ?? "" })),
      total: page.total, curseur_suivant: page.curseur_suivant, quota_restant_aujourdhui: page.quota_restant_aujourdhui,
    };
  });
}

// ---------------------------------------------------------------- vers Mail

export type ListeMail = { id: string; nom: string; sequence: boolean };

export async function listesMail(a: Appel): Promise<{ listes: ListeMail[] }> {
  const p = await preparer(a, "notifuse");
  const r = await appelerMail(await jeton(p, "notifuse", "bouton.envoyer_vers_mail"), "listes.lister", {}, `listes:${randomUUID()}`);
  const brutes = (Array.isArray(r.listes) ? r.listes : Array.isArray(r.lists) ? r.lists : []) as Record<string, unknown>[];
  return {
    listes: brutes
      .filter((l) => typeof l?.id === "string")
      .map((l) => ({ id: String(l.id), nom: String(l.nom ?? l.name ?? l.id).slice(0, 120), sequence: l.sequence === true })),
  };
}

export async function creerListeMail(a: Appel, e: { geste: string; nom: string }) {
  const p = await preparer(a, "notifuse");
  const id = `atlas${createHash("sha256").update(`${a.ctx.tenantId}:${e.geste}`).digest("hex").slice(0, 20)}`;
  return uneFois({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, geste: e.geste, etape: "liste", cible: "notifuse", reference: id }, async () => {
    await appelerMail(await jeton(p, "notifuse", "bouton.creer_liste"), "listes.creer", { id, name: e.nom }, `${e.geste}:liste`);
    return { id, nom: e.nom, sequence: false };
  });
}

const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

async function importer(p: Pret, contacts: Record<string, unknown>[], listeId: string, simulation: boolean, motif: string, cle: string) {
  // Ni `allow_triggers` ni `existing` : Mail les fixe lui-même, un envoi depuis Atlas ne démarre aucune séquence.
  const r = await appelerMail(await jeton(p, "notifuse", motif), "contacts.importer", { contacts, list_ids: [listeId], dry_run: simulation }, cle);
  // Une simulation qui aurait écrit, ou l'inverse, ne se présente pas comme réussie.
  if (r.dry_run !== simulation) throw new RefusLiaison("reponse_invalide", "Réponse inattendue de Mail : vérifiez la liste avant de recommencer.", 502);
  const ecartes = Object.fromEntries(Object.entries((r.skipped ?? {}) as Record<string, unknown>).map(([k, v]) => [k.slice(0, 60), nombre(v)]).filter(([, v]) => v));
  return { recus: nombre(r.received), crees: nombre(r.created), existants: nombre(r.existing) + nombre(r.updated), inscrits: nombre(r.subscribed), ecartes, declenche: Array.isArray(r.triggers) && r.triggers.length > 0 };
}

export async function ficheVersMail(a: Appel, e: { geste: string; siren: string; listeId: string; simulation: boolean }) {
  const p = await preparer(a, "notifuse");
  const etape = e.simulation ? "fiche-sim" : "fiche";
  return uneFois({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, geste: e.geste, etape, cible: "notifuse", reference: `${e.siren}:${e.listeId}` }, async (id) => {
    const [l] = await sourceMarche().extraire([e.siren]);
    if (!l) throw new RefusLiaison("sans_email", "Cette entreprise n'a pas d'adresse email utilisable.", 409);
    // La simulation d'une fiche ne sort rien de plus que son import : comptée à l'import seulement.
    if (!e.simulation) await reserverFiche({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, client: null, canal: "liaison" }, "notifuse", id);
    const r = await importer(p, [contactMail(l, "fiche")], e.listeId, e.simulation, "bouton.envoyer_vers_mail", `${e.geste}:${etape}`);
    return { ...r, total: 1, retirees: 0, curseur_suivant: null as string | null };
  });
}

export async function segmentVersMail(a: Appel, e: { geste: string; segmentId: string; listeId: string; curseur?: string | null; simulation: boolean }) {
  const p = await preparer(a, "notifuse");
  const s = await seg.lireSegment(a.ctx.tenantId, e.segmentId);
  const debut = (e.curseur && decoderCurseur(e.curseur)?.debut) || 0;
  const etape = `${e.simulation ? "sim" : "imp"}:${debut}`;
  if (!e.simulation) {
    // Simulation puis confirmation : on n'importe que la page simulée, de la même liste figée, par le même geste.
    const sim = e.curseur && (await prisma.atlasEnvoi.findUnique({ where: { tenantId_geste_etape: { tenantId: a.ctx.tenantId, geste: e.geste, etape: `sim:${debut}` } } }));
    const vue = sim && sim.etat === "fait" && sim.userId === a.ctx.userId && sim.reference === `${e.segmentId}:${e.listeId}` ? (sim.resultat as { curseur_page?: string }) : null;
    if (!vue || vue.curseur_page !== e.curseur) throw new RefusLiaison("simuler", "Simulez d'abord l'envoi vers cette liste.", 409);
  }
  return uneFois({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, geste: e.geste, etape, cible: "notifuse", reference: `${e.segmentId}:${e.listeId}` }, async () => {
    const page = await extraireSegment({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, client: null, canal: "liaison" }, { segmentId: e.segmentId, curseur: e.curseur, limite: PAGE_MAIL });
    const r = page.lignes.length
      ? await importer(p, page.lignes.map((l) => contactMail(l, s.nom)), e.listeId, e.simulation, "segment.envoyer_vers_mail", `${e.geste}:${etape}`)
      : { recus: 0, crees: 0, existants: 0, inscrits: 0, ecartes: {}, declenche: false };
    return { ...r, total: page.total, retirees: page.retires.length, curseur_page: page.curseur_page, curseur_suivant: page.curseur_suivant, quota_restant_aujourdhui: page.quota_restant_aujourdhui };
  });
}
