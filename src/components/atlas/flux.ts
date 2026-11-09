/**
 * Flux produit d'Atlas (docs/PLAN-ATLAS.md, « Flux produit ») : Marché (segment racine) → Cibles
 * (segments enfants) → Priorité (scoring) → Envoi. Plus la lecture des versions (diff, auteur IA) et
 * la détection de l'activité d'une IA entre deux relevés. Logique pure, testée dans __tests__/atlas-ui.
 */
import { cheminDossier, phraseCondition } from "./logique";
import type { Arbre, ChampInfo, Condition, Filtre, SegmentArbre } from "./types";

// ---------------------------------------------------------------- marchés et cibles

/** Un marché est un segment sans parent (ou dont le parent a disparu). */
export function estMarche(s: SegmentArbre, a: Arbre): boolean {
  return !s.parent_id || !a.segments.some((x) => x.id === s.parent_id);
}

/** Le marché d'un segment : on remonte la chaîne des parents (protégé contre les boucles). */
export function marcheDe(a: Arbre, id: string): SegmentArbre | null {
  let s = a.segments.find((x) => x.id === id) ?? null;
  for (let i = 0; s && i < 12; i++) {
    if (estMarche(s, a)) return s;
    const parent: string | null = s.parent_id;
    s = a.segments.find((x) => x.id === parent) ?? null;
  }
  return s;
}

export type CibleRail = { segment: SegmentArbre; profondeur: number };

/** Cibles d'un marché, à plat dans l'ordre de l'arbre, avec leur profondeur (1 = cible directe). */
export function ciblesDe(a: Arbre, marcheId: string): CibleRail[] {
  const out: CibleRail[] = [];
  const vus = new Set<string>([marcheId]);
  const visiter = (parent: string, profondeur: number) => {
    for (const s of a.segments.filter((x) => x.parent_id === parent)) {
      if (vus.has(s.id) || profondeur > 6) continue;
      vus.add(s.id);
      out.push({ segment: s, profondeur });
      visiter(s.id, profondeur + 1);
    }
  };
  visiter(marcheId, 1);
  return out;
}

export type SectionRail = { id: string; nom: string; marches: SegmentArbre[] };

/** Sections du rail : un dossier (chemin complet) par section, ses marchés dedans ; « Sans dossier » à la fin. */
export function sectionsRail(a: Arbre): SectionRail[] {
  const dossiers = new Set(a.dossiers.map((d) => d.id));
  const marches = a.segments.filter((s) => estMarche(s, a));
  const sections: SectionRail[] = a.dossiers
    .map((d) => ({ id: d.id, nom: cheminDossier(a, d.id).join(" › "), marches: marches.filter((s) => s.dossier_id === d.id) }))
    .filter((s) => s.marches.length > 0)
    .sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
  const libres = marches.filter((s) => !s.dossier_id || !dossiers.has(s.dossier_id));
  if (libres.length) sections.push({ id: "", nom: "Sans dossier", marches: libres });
  return sections;
}

export type Etape = "marche" | "cible" | "priorite" | "envoi";

/** Où en est l'utilisateur dans le flux. Sans segment : on explore le marché. */
export function etapeCourante(a: Arbre | null, id: string | null, vuePriorite: boolean): Etape {
  if (!a || !id) return "marche";
  const s = a.segments.find((x) => x.id === id);
  if (!s || estMarche(s, a)) return "marche";
  return vuePriorite ? "priorite" : "cible";
}

// ---------------------------------------------------------------- versions

/** Les différences entre deux filtres, en phrases : « + Département parmi 69 », « − Site renseigné ». */
export function diffFiltres(avant: Filtre | null, apres: Filtre, champs: ReadonlyMap<string, ChampInfo>): string[] {
  if (!avant) return ["création"];
  const cle = (c: Condition) => JSON.stringify([c.champ, c.op, c.valeur]);
  const a = new Map(avant.conditions.map((c) => [cle(c), c]));
  const b = new Map(apres.conditions.map((c) => [cle(c), c]));
  const out = [
    ...[...b].filter(([k]) => !a.has(k)).map(([, c]) => `+ ${phraseCondition(c, champs)}`),
    ...[...a].filter(([k]) => !b.has(k)).map(([, c]) => `− ${phraseCondition(c, champs)}`),
  ];
  if (!!avant.inclure_bloques !== !!apres.inclure_bloques) out.push(apres.inclure_bloques ? "+ bloquées incluses" : "− bloquées incluses");
  return out.length ? out : ["sans changement de filtre"];
}

export const estAuteurIA = (auteur: string) => auteur.startsWith("ia:");

/** IA vue dans Atlas : active pendant cette session, ou seulement branchée (déjà venue par le connecteur). */
export type IAVue = { nom: string; heure: string; etat: "active" | "branchee" };
export type ConnexionIA = { nom: string; depuis: string; dernier_appel: string };

/** Heure si c'est aujourd'hui, sinon la date courte. */
export function quand(iso: string, maintenant = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return d.toDateString() === maintenant.toDateString() ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/** Les IA actives cette session d'abord, puis celles branchées qui n'ont pas agi ici (une ligne par nom). */
export function fusionnerIAs(session: readonly IAVue[], connexions: readonly ConnexionIA[], maintenant = new Date()): IAVue[] {
  const vues = new Set(session.map((i) => i.nom));
  const branchees: IAVue[] = [];
  for (const c of connexions) {
    if (vues.has(c.nom)) continue;
    vues.add(c.nom);
    branchees.push({ nom: c.nom, heure: quand(c.dernier_appel, maintenant), etat: "branchee" });
  }
  return [...session, ...branchees];
}

/** « ia:claude-ai » → « Claude » ; « ia:chatgpt » → « ChatGPT » ; un humain → « Interface ». */
export function nomAuteur(auteur: string): string {
  if (!estAuteurIA(auteur)) return "Interface";
  const client = auteur.slice(3).trim();
  const bas = client.toLowerCase();
  if (bas.startsWith("mcpc_")) return "Assistant IA"; // identifiant OAuth opaque, sans nom donné par le Hub
  if (bas.includes("claude") || bas.includes("anthropic")) return "Claude";
  if (bas.includes("chatgpt") || bas.includes("openai") || bas.includes("gpt")) return "ChatGPT";
  if (bas.includes("mistral") || bas.includes("lechat")) return "Mistral";
  if (bas.includes("gemini") || bas.includes("google")) return "Gemini";
  return client ? client.charAt(0).toUpperCase() + client.slice(1) : "IA";
}

export const initialeAuteur = (nom: string) => (nom.trim().charAt(0) || "?").toUpperCase();

export function formaterHorodatage(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// ---------------------------------------------------------------- présence de l'IA

export type Changement = { id: string; nom: string; avant: number | null; apres: number; scoring: boolean; nouveau: boolean };

/**
 * Segments dont le filtre ou le scoring a pris une version entre deux relevés, et segments
 * apparus. Le premier relevé (avant = null) ne signale rien.
 */
export function segmentsChanges(avant: readonly SegmentArbre[] | null, apres: readonly SegmentArbre[]): Changement[] {
  if (!avant) return [];
  const m = new Map(avant.map((s) => [s.id, s]));
  const out: Changement[] = [];
  for (const s of apres) {
    const p = m.get(s.id);
    if (!p) out.push({ id: s.id, nom: s.nom, avant: null, apres: s.version, scoring: false, nouveau: true });
    else if (s.version > p.version) out.push({ id: s.id, nom: s.nom, avant: p.version, apres: s.version, scoring: false, nouveau: false });
    else if ((s.scoring ?? 0) > (p.scoring ?? 0)) out.push({ id: s.id, nom: s.nom, avant: p.scoring, apres: s.scoring ?? 0, scoring: true, nouveau: false });
  }
  return out;
}

/** La phrase de la bulle d'activité : « Claude a modifié « Éleveurs bovins » (v4) ». */
export function phraseActivite(ia: string, c: Changement): string {
  if (c.nouveau) return `${ia} a créé « ${c.nom} »`;
  if (c.scoring) return `${ia} a revu la priorité de « ${c.nom} » (v${c.apres})`;
  return `${ia} a modifié « ${c.nom} » (v${c.apres})`;
}

// ---------------------------------------------------------------- chiffres et entonnoir

export const avecCondition = (f: Filtre, c: Condition): Filtre => ({ ...f, conditions: [...f.conditions, c] });

export const avecDepartement = (f: Filtre, code: string | null): Filtre => (code ? avecCondition(f, { champ: "departement", op: "dans", valeur: [code] }) : f);

/** Jours d'envoi à un rythme donné (400 par jour par défaut, comme la maquette), sur les emails envoyables. */
export const joursEnvoi = (n: number, parJour = 400) => (n > 0 ? Math.ceil(n / parJour) : 0);

export type Kpi = { id: string; libelle: string; condition: Condition | null };

/** Chiffres clés : toujours le total, puis ceux dont le champ existe au catalogue. */
export function kpisDisponibles(champs: ReadonlyMap<string, ChampInfo>): Kpi[] {
  const kpis: Kpi[] = [{ id: "total", libelle: "entreprises", condition: null }];
  if (champs.has("email")) kpis.push({ id: "email", libelle: "avec email", condition: { champ: "email", op: "renseigne", valeur: true } });
  if (champs.has("email_envoyable")) kpis.push({ id: "envoyable", libelle: "emails envoyables", condition: { champ: "email_envoyable", op: "est", valeur: true } });
  if (champs.has("dirigeant")) kpis.push({ id: "dirigeant", libelle: "dirigeants identifiés", condition: { champ: "dirigeant", op: "renseigne", valeur: true } });
  return kpis;
}

export type EtapeEntonnoir = { libelle: string; filtre: Filtre };

/**
 * Ce que coûte chaque filtre, dans l'ordre : on part des conditions héritées du marché (ou de toutes
 * les entreprises) et on ajoute une à une celles du segment. Au plus `max` étapes, la dernière
 * portant toujours le filtre complet.
 */
export function etapesEntonnoir(propres: readonly Condition[], heritees: readonly Condition[], inclureBloques: boolean, champs: ReadonlyMap<string, ChampInfo>, max = 8): EtapeEntonnoir[] {
  const base: Filtre = { conditions: [...heritees], inclure_bloques: inclureBloques };
  const etapes: EtapeEntonnoir[] = [{ libelle: heritees.length ? "Marché" : "Toutes les entreprises", filtre: base }];
  const n = Math.min(propres.length, Math.max(1, max - 1));
  for (let i = 0; i < n; i++) {
    const derniere = i === n - 1;
    const conditions = derniere ? [...heritees, ...propres] : [...heritees, ...propres.slice(0, i + 1)];
    const libelle = derniere && propres.length > n ? `${phraseCondition(propres[i], champs)} et ${propres.length - n} autres` : phraseCondition(propres[i], champs);
    etapes.push({ libelle, filtre: { conditions, inclure_bloques: inclureBloques } });
  }
  return etapes;
}
