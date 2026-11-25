/**
 * Actions offertes aux autres apps Veridian (docs/LIAISONS.md, sens inverse) : le CRM cherche une entreprise et enrichit une
 * fiche, au nom de l'utilisateur. Lecture seule : rien ne s'écrit dans Atlas, sauf la trace et le quota des coordonnées.
 *
 * Coordonnées : mêmes règles que l'envoi d'une fiche vers le CRM (liaisons.ts). Plan payant, 5 000 lignes par jour et par
 * espace, tracées ; jamais gardées en base, un rejeu les relit sans les recompter.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import type { UserContext } from "@/lib/auth/user-context";
import { uneFois } from "@/lib/liaisons/envois";
import { RefusLiaison } from "@/lib/liaisons/erreurs";

import { peutExporter } from "./export";
import { RefusExtraction, reserverFiche } from "./extraction";
import { telephoneInternational } from "./liaisons";
import { NAF_LIBELLES } from "./naf";
import { sourceMarche } from "./source";

export class RefusAction extends Error {
  constructor(readonly code: string, readonly statut: number, readonly detail?: string, readonly attendre?: number) {
    super(code);
  }
}

export type AppelAction = { ctx: UserContext; app: string; plan: string | null; cle: string | null };
export type Action = { portee: string; apps: readonly string[]; cle: boolean; entree: z.ZodObject; run: (e: never, a: AppelAction) => Promise<Record<string, unknown>> };

const domaineDe = (q: string) => /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?].*)?$/.exec(q.trim().toLowerCase())?.[1] ?? null;

/** Ce que cherche l'utilisateur : un SIREN, un SIRET, un domaine, sinon un nom. */
export function lireRecherche(q: string): { siren: string } | { domaine: string } | { mots: string[] } {
  const chiffres = q.replace(/[\s.]/g, "");
  if (/^\d{9}$/.test(chiffres) || /^\d{14}$/.test(chiffres)) return { siren: chiffres.slice(0, 9) };
  const domaine = domaineDe(q);
  if (domaine) return { domaine };
  // Les mots entiers de l'index de noms d'ODH, sans accents ; « SARL Dupont & fils » cherche dupont et fils.
  const mots = q.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 2 && !FORMES.has(m));
  if (!mots.length) throw new RefusAction("demande_invalide", 400, "Nom, SIREN, SIRET ou domaine attendu.");
  return { mots: [...new Set(mots)].slice(0, 6) };
}
const FORMES = new Set(["sarl", "sas", "sasu", "eurl", "sa", "sci", "snc", "societe", "ste", "et", "la", "le", "les", "de", "du", "des"]);

const chercher: Action = {
  portee: "prospection:entreprise.lire",
  apps: ["crm"],
  cle: false,
  entree: z.object({ q: z.string().trim().min(2).max(200), code_postal: z.string().regex(/^\d{5}$/).nullish(), limite: z.number().int().min(1).max(20).default(10) }).strict(),
  run: async (e: { q: string; code_postal?: string | null; limite: number }) => ({
    entreprises: await sourceMarche().chercher({ ...lireRecherche(e.q), codePostal: e.code_postal ?? null, limite: e.limite }),
  }),
};

const SECTIONS = ["identite", "activite", "lieu", "dirigeant", "web", "finances", "signaux"] as const;

const enrichir: Action = {
  portee: "prospection:entreprise.lire",
  apps: ["crm"],
  cle: true,
  entree: z.object({ siren: z.string().regex(/^\d{9}$/) }).strict(),
  run: async (e: { siren: string }, a: AppelAction) => {
    const source = sourceMarche();
    const contact = await source.pourCrm(e.siren);
    // Non prospectable (fermée, diffusion limitée, bloquée) : identité publique seule, jamais un dirigeant ni une coordonnée.
    const fiche = contact ? await source.fiche(e.siren) : await source.ficheMaitre(e.siren);
    if (!fiche) throw new RefusAction("entreprise_inconnue", 404, "Aucune entreprise à ce SIREN.");
    const bloc = (k: string) => (fiche as Record<string, Record<string, unknown> | undefined>)[k] ?? {};
    const socle = {
      siren: e.siren,
      nom: bloc("identite").nom ?? null,
      url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://prospection.app.veridian.site"}/?siren=${e.siren}`,
      prospectable: !!contact,
      naf_libelle: NAF_LIBELLES[String(bloc("activite").naf ?? "")] ?? null,
      ...Object.fromEntries((contact ? SECTIONS : (["identite", "activite", "lieu"] as const)).map((k) => [k, sansAdresse(bloc(k))])),
    };
    if (!contact) return { ...socle, coordonnees: "non_prospectable" };
    const email = contact.email, telephone = telephoneInternational(contact.telephone);
    if (!email && !telephone) return { ...socle, coordonnees: "aucune" };
    if (!peutExporter(a.plan)) return { ...socle, coordonnees: "plan", masque: [email && "email", telephone && "telephone"].filter(Boolean) };
    const geste = uuidDe(`${a.app}:${a.ctx.userId}:${a.cle!}`);
    const { rejoue } = await uneFois({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, geste, etape: "enrichir", cible: "crm", reference: e.siren }, async (id) => {
      await reserverFiche({ tenantId: a.ctx.tenantId, userId: a.ctx.userId, client: `app:${a.app}`, canal: "liaison" }, "enrichir", id);
      return { siren: e.siren } as { siren: string; rejoue?: boolean };
    });
    return { ...socle, coordonnees: "jointes", contact: { email, telephone }, ...(rejoue ? { rejoue: true } : {}) };
  },
};

/** La clé d'une app, ramenée à l'identifiant de geste de la base. */
const uuidDe = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");

/** L'adresse d'un dirigeant est une coordonnée : elle ne passe que par `contact`. */
const sansAdresse = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !/email|telephone|phone/i.test(k) && v !== null && v !== undefined && v !== ""));

export const ACTIONS: Record<string, Action> = { "entreprises.chercher": chercher, "entreprises.enrichir": enrichir };

/** Refus des briques partagées, dans le vocabulaire des actions (fiche 87 de Notifuse). */
export function enRefus(e: unknown): RefusAction {
  if (e instanceof RefusAction) return e;
  if (e instanceof RefusExtraction) return new RefusAction("quota", 429, e.message, 3600);
  if (e instanceof RefusLiaison && e.code === "en_cours") return new RefusAction("en_cours", 409, e.message, 5);
  if (e instanceof RefusLiaison && e.code === "geste_reutilise") return new RefusAction("cle_reutilisee", 422, e.message);
  console.error("[actions]", e);
  return new RefusAction("echec", 503, "Atlas est indisponible, réessayez.", 10);
}
