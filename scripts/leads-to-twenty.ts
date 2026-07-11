#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * leads-to-twenty.ts — Pont SEARCH (moteur IA Prospection) → Twenty CRM.
 * ============================================================================
 *
 * BUT
 * ---
 * Un agent Claude a trouvé un SEGMENT d'entreprises via l'API de recherche IA
 * (POST /api/search/companies). Ce script prend ce segment (via --filters ou
 * une liste explicite --sirens) et le POUSSE dans le CRM Twenty de façon
 * IDEMPOTENTE : rejouable sans créer de doublons.
 *
 * Il ne réécrit PAS l'auth Twenty : il appelle le CLI `~/bin/twenty` (skill
 * admin-twenty) en sous-processus pour toute I/O CRM. Le CLI porte le Bearer
 * admin, gère prod/staging, et absorbe les pièges REST. Aucun secret en dur.
 *
 * FLUX
 * ----
 *   1. Interroge le search API (bearer PROSPECTION_TENANT_API_SECRET du vault),
 *      pagine jusqu'à --limit, projette les champs utiles.
 *   2. Mappe chaque entreprise → payload Twenty selon FIELD_MAP (configurable).
 *   3. Upsert idempotent par siren : lookup REST (filter=siren[eq]) → PATCH si
 *      existant, POST sinon. Backoff exponentiel sur 429.
 *   4. Résumé final : créés / màj / skippés / erreurs.
 *
 * USAGE
 * -----
 *   npx tsx scripts/leads-to-twenty.ts --filters '<json SearchFilters>' \
 *        [--limit 500] [--object companies|people|cold_prospects] \
 *        [--campaign "Ecom boutique juillet"] [--dry-run] \
 *        [--api-url https://prospection.staging.veridian.site] \
 *        [--twenty-env prod|staging]
 *
 *   # ou liste explicite de SIREN (le search API les résout quand même) :
 *   npx tsx scripts/leads-to-twenty.ts --sirens 546880139,552032534 --dry-run
 *
 * --dry-run n'écrit RIEN dans Twenty : affiche ce qui SERAIT poussé.
 *
 * ⚠️ FIELDS TWENTY À CONFIRMER — voir scripts/README-leads-to-twenty.md.
 *    Le mapping est volontairement isolé dans FIELD_MAP ci-dessous : si un
 *    field custom manque côté Twenty, on l'ajuste ICI sans toucher au reste.
 * ============================================================================
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — mapping entreprise (search) → objet Twenty. TOUT ce qui dépend du
// schéma Twenty est ici. Le lead/skill ajuste ces clés si les fields custom
// diffèrent, sans lire le reste du fichier.
// ─────────────────────────────────────────────────────────────────────────────

/** Champs demandés au search API (projection). Doivent exister dans FIELD_CATALOG. */
const SEARCH_FIELDS = [
  "siren",
  "denomination",
  "secteur_final",
  "commune",
  "departement",
  "code_postal",
  "chiffre_affaires",
  "phone",
  "email",
  "web_domain",
  "dirigeant_nom",
  "dirigeant_qualite",
  "ecom_level",
  "ecom_platform",
  "prospect_score",
  "web_obsolescence_score",
  "est_rge",
] as const;

/** Une entreprise telle que renvoyée par /api/search/companies. */
type Company = Record<string, unknown>;

/**
 * Objets Twenty supportés. `companies` = cible RECOMMANDÉE (porte le field
 * custom `siren` → dédup stable + fields riches). `people` = dirigeant
 * (email/phone natifs). `cold_prospects` = pile de cold-call minimaliste
 * (⚠️ PAS de field siren → dédup faible, cf README).
 */
type TwentyObject = "companies" | "people" | "cold_prospects";

/**
 * REST paths + clé de collection dans la réponse, par objet.
 * (Twenty REST renvoie { data: { <collectionKey>: [...] } }.)
 */
const REST_META: Record<TwentyObject, { path: string; collection: string; dedupField: string | null }> = {
  companies: { path: "/rest/companies", collection: "companies", dedupField: "siren" },
  people: { path: "/rest/people", collection: "people", dedupField: null }, // dédup par email (composite, cf lookupPersonByEmail)
  cold_prospects: { path: "/rest/coldProspects", collection: "coldProspects", dedupField: null },
};

/**
 * FIELD_MAP — construit le payload Twenty à partir d'une entreprise.
 * Retourne un objet prêt pour POST/PATCH REST (composites Twenty inclus).
 *
 * Composites Twenty (vérifiés sur le workspace 2026-07-11) :
 *   name(person) = {firstName,lastName}
 *   emails       = {primaryEmail, additionalEmails:[]}
 *   phones       = {primaryPhoneNumber, primaryPhoneCallingCode, primaryPhoneCountryCode}
 *   domainName   = {primaryLinkUrl, primaryLinkLabel, secondaryLinks:[]}
 *   annualRevenue= {amountMicros, currencyCode}
 */
const FIELD_MAP: Record<TwentyObject, (c: Company, campaign: string | null) => Record<string, unknown>> = {
  // ─── companies : cible principale (siren + fields riches) ───
  companies: (c, campaign) => {
    const payload: Record<string, unknown> = {
      name: str(c.denomination) || `SIREN ${str(c.siren)}`,
      siren: str(c.siren),
    };
    const domain = normalizeDomain(str(c.web_domain));
    if (domain) {
      payload.domainName = { primaryLinkUrl: domain, primaryLinkLabel: "", secondaryLinks: [] };
      payload.siteWebUrl = domain; // champ texte libre côté Twenty
    }
    if (str(c.secteur_final)) payload.secteur = str(c.secteur_final);
    if (str(c.commune)) payload.commune = str(c.commune);
    if (str(c.departement)) payload.departement = str(c.departement);
    if (str(c.code_postal)) payload.codePostal = str(c.code_postal);
    if (str(c.code_naf ?? c.codeNaf)) payload.codeNaf = str(c.code_naf ?? c.codeNaf);
    const ca = num(c.chiffre_affaires);
    if (ca != null) payload.annualRevenue = { amountMicros: Math.round(ca * 1_000_000), currencyCode: "EUR" };
    const score = num(c.prospect_score);
    if (score != null) payload.prospectScore = score;
    const wobs = num(c.web_obsolescence_score);
    if (wobs != null) payload.webObsolescenceScore = wobs;
    // idealCustomerProfile = drapeau texte "ecom boutique / catalogue" + campagne
    payload.idealCustomerProfile = buildIcpTag(c, campaign);
    return payload;
  },

  // ─── people : contact dirigeant (email/phone natifs) ───
  people: (c) => {
    const { firstName, lastName } = splitName(str(c.dirigeant_nom));
    const payload: Record<string, unknown> = {
      name: { firstName, lastName },
    };
    const email = str(c.email);
    if (email) payload.emails = { primaryEmail: email, additionalEmails: [] };
    const phone = str(c.phone);
    if (phone) {
      payload.phones = {
        primaryPhoneNumber: phone,
        primaryPhoneCallingCode: "",
        primaryPhoneCountryCode: "FR",
      };
    }
    if (str(c.dirigeant_qualite)) payload.jobTitle = str(c.dirigeant_qualite);
    const score = num(c.prospect_score);
    if (score != null) payload.prospectScore = score;
    return payload;
  },

  // ─── cold_prospects : pile de cold-call (schéma minimaliste réel) ───
  cold_prospects: (c, campaign) => {
    const payload: Record<string, unknown> = {
      name: str(c.dirigeant_nom) || str(c.denomination) || `SIREN ${str(c.siren)}`,
      societe: str(c.denomination),
      telephone: str(c.phone),
      source: campaign ? `search:${campaign}` : "search:prospection",
      statut: "A_APPELER",
      position: "last",
    };
    // Pas de field siren/email natif → on trace le contexte dans notes pour
    // garder la donnée (et permettre une dédup best-effort par societe+tel).
    payload.notes = buildNotes(c, campaign);
    return payload;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS de mapping (purs, testables)
// ─────────────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "DUPONT Jean" / "Jean Dupont" → {firstName, lastName} best-effort. */
function splitName(full: string): { firstName: string; lastName: string } {
  const clean = full.replace(/\s+/g, " ").trim();
  if (!clean) return { firstName: "", lastName: "" };
  const parts = clean.split(" ");
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  // Convention INPI : NOM en tête (souvent MAJUSCULES) → lastName = 1er token.
  const [first, ...rest] = parts;
  const looksLikeSurnameFirst = first === first.toUpperCase() && first.length > 1;
  if (looksLikeSurnameFirst) return { firstName: rest.join(" "), lastName: first };
  return { firstName: first, lastName: rest.join(" ") };
}

/** Normalise un domaine en URL http(s) exploitable par Twenty domainName. */
function normalizeDomain(d: string): string {
  if (!d) return "";
  const trimmed = d.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Tag ICP lisible : niveau ecom + plateforme + campagne. */
function buildIcpTag(c: Company, campaign: string | null): string {
  const bits: string[] = [];
  const level = str(c.ecom_level);
  if (level && level !== "aucun") bits.push(`ecom:${level}`);
  const plat = str(c.ecom_platform);
  if (plat) bits.push(plat);
  if (campaign) bits.push(campaign);
  return bits.join(" · ");
}

/** Notes cold_prospect : embarque les infos non mappables (siren, email, ecom). */
function buildNotes(c: Company, campaign: string | null): string {
  const lines: string[] = [];
  if (str(c.siren)) lines.push(`SIREN ${str(c.siren)}`);
  if (str(c.email)) lines.push(`Email: ${str(c.email)}`);
  if (str(c.web_domain)) lines.push(`Site: ${str(c.web_domain)}`);
  const icp = buildIcpTag(c, campaign);
  if (icp) lines.push(icp);
  if (str(c.commune)) lines.push(`${str(c.commune)} (${str(c.departement)})`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing (argv simple, zéro dépendance)
// ─────────────────────────────────────────────────────────────────────────────

interface Args {
  filters?: string;
  sirens?: string;
  limit: number;
  object: TwentyObject;
  campaign: string | null;
  dryRun: boolean;
  apiUrl: string;
  twentyEnv: "prod" | "staging";
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    limit: 500,
    object: "companies",
    campaign: null,
    dryRun: false,
    apiUrl: process.env.SEARCH_API_URL || "https://prospection.staging.veridian.site",
    twentyEnv: "prod",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--filters": out.filters = next(); break;
      case "--sirens": out.sirens = next(); break;
      case "--limit": out.limit = Math.max(1, parseInt(next(), 10) || 500); break;
      case "--object": {
        const v = next();
        if (v !== "companies" && v !== "people" && v !== "cold_prospects") {
          fail(`--object invalide: ${v} (attendu: companies|people|cold_prospects)`);
        }
        out.object = v;
        break;
      }
      case "--campaign": out.campaign = next(); break;
      case "--dry-run": out.dryRun = true; break;
      case "--api-url": out.apiUrl = next().replace(/\/+$/, ""); break;
      case "--twenty-env": {
        const v = next();
        if (v !== "prod" && v !== "staging") fail(`--twenty-env invalide: ${v}`);
        out.twentyEnv = v;
        break;
      }
      case "-h": case "--help": printHelpAndExit(); break;
      default: fail(`argument inconnu: ${a}`);
    }
  }
  if (!out.filters && !out.sirens) {
    fail("il faut --filters '<json>' OU --sirens 123,456");
  }
  return out;
}

function printHelpAndExit(): never {
  console.log(`
leads-to-twenty — pousse un segment SEARCH → Twenty CRM (idempotent).

  --filters '<json SearchFilters>'   filtres du moteur IA (ex: '{"all":[{"field":"ecom_platform","op":"exists","value":true}]}')
  --sirens 123,456                   liste explicite de SIREN (alternative à --filters)
  --limit N                          nb max de leads (défaut 500)
  --object companies|people|cold_prospects   cible Twenty (défaut companies)
  --campaign "<nom>"                 étiquette de campagne (ICP/source)
  --dry-run                          n'écrit rien, affiche ce qui serait poussé
  --api-url <url>                    base du search API (défaut staging)
  --twenty-env prod|staging          workspace Twenty ciblé (défaut prod)

Secrets lus depuis ~/credentials/.all-creds.env — jamais en argument.
`);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials — lecture du vault (jamais de secret en dur / en argv)
// ─────────────────────────────────────────────────────────────────────────────

/** Lit une clé du vault ~/credentials/.all-creds.env (ou de l'env process). */
function readCred(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(join(homedir(), "credentials", ".all-creds.env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* vault absent → on retombe sur undefined */
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH API — récupération paginée du segment
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Construit les filtres à envoyer au search API selon --filters | --sirens. */
function buildSearchFilters(args: Args): unknown {
  if (args.sirens) {
    const list = args.sirens.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) fail("--sirens vide");
    return { all: [{ field: "siren", op: "in", value: list }] };
  }
  try {
    return JSON.parse(args.filters as string);
  } catch (e) {
    fail(`--filters n'est pas un JSON valide: ${(e as Error).message}`);
  }
}

/**
 * Récupère le segment via POST /api/search/companies, page par page,
 * jusqu'à --limit (page_size max côté API = 200).
 */
async function fetchSegment(args: Args, bearer: string): Promise<Company[]> {
  const filters = buildSearchFilters(args);
  const pageSize = Math.min(200, args.limit);
  const out: Company[] = [];
  let page = 1;

  while (out.length < args.limit) {
    const res = await fetchWithTimeout(
      `${args.apiUrl}/api/search/companies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          filters,
          fields: SEARCH_FIELDS,
          page,
          page_size: pageSize,
          sort: { field: "prospect_score", dir: "desc" },
        }),
      },
      SEARCH_TIMEOUT_MS,
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      fail(`search API ${res.status}: ${txt.slice(0, 300)}`);
    }
    const json = (await res.json()) as { results?: Company[] };
    const batch = json.results ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break; // dernière page
    page++;
  }

  return out.slice(0, args.limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// TWENTY — appel du CLI ~/bin/twenty (pas de réécriture de l'auth)
// ─────────────────────────────────────────────────────────────────────────────

const TWENTY_BIN = join(homedir(), "bin", "twenty");
const MAX_RETRIES = 4;

/** Résultat brut d'un appel REST via le CLI twenty. */
interface RestResult {
  ok: boolean;
  status: number;
  json: any;
  raw: string;
}

/**
 * Appelle `twenty rest <METHOD> <path> [--data <json>]`.
 * Gère le 429 (backoff exponentiel) en relançant l'appel.
 * Le CLI porte le Bearer admin + l'env (prod/staging).
 */
async function twentyRest(
  env: "prod" | "staging",
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<RestResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const cliArgs = ["--env", env, "rest", method, path];
    if (data !== undefined) cliArgs.push("--data", JSON.stringify(data));

    const proc = spawnSync(TWENTY_BIN, cliArgs, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });

    const raw = (proc.stdout || "") + (proc.stderr || "");
    let json: any = null;
    try {
      json = JSON.parse(proc.stdout || "null");
    } catch {
      /* réponse non-JSON (erreur CLI) → géré ci-dessous */
    }

    // Détection 429 (rate limit) — dans le corps JSON ou le texte brut.
    const is429 =
      json?.error?.statusCode === 429 ||
      json?.statusCode === 429 ||
      /\b429\b|too many requests|rate limit/i.test(raw);

    if (is429 && attempt < MAX_RETRIES) {
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await sleep(backoff);
      continue;
    }

    // Succès = exit 0 + pas d'objet d'erreur GraphQL/REST détecté.
    const hasError = json?.error != null || json?.messages != null || proc.status !== 0;
    return {
      ok: !hasError,
      status: json?.error?.statusCode ?? (proc.status === 0 ? 200 : 500),
      json,
      raw: raw.slice(0, 500),
    };
  }
  return { ok: false, status: 429, json: null, raw: "429 après retries" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cherche un record existant pour dédup, retourne son id ou null.
 * - companies : filter=siren[eq]
 * - people    : filter=emails.primaryEmail[eq] (si email présent)
 * - cold_prospects : dédup best-effort par societe+telephone
 */
async function lookupExisting(
  env: "prod" | "staging",
  object: TwentyObject,
  c: Company,
): Promise<string | null> {
  const meta = REST_META[object];
  let filter: string | null = null;

  if (object === "companies") {
    const siren = str(c.siren);
    if (!siren) return null;
    filter = `siren[eq]:${encodeURIComponent(siren)}`;
  } else if (object === "people") {
    const email = str(c.email);
    if (!email) return null;
    filter = `emails.primaryEmail[eq]:${encodeURIComponent(email)}`;
  } else {
    // cold_prospects : pas de field stable → dédup faible par societe.
    const societe = str(c.denomination);
    if (!societe) return null;
    filter = `societe[eq]:${encodeURIComponent(societe)}`;
  }

  const res = await twentyRest(env, "GET", `${meta.path}?filter=${filter}&limit=1`);
  if (!res.ok) return null;
  const rows = res.json?.data?.[meta.collection] ?? [];
  return rows.length > 0 ? rows[0].id ?? null : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT — orchestration idempotente d'un lead
// ─────────────────────────────────────────────────────────────────────────────

interface Stats {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorSamples: string[];
}

async function upsertLead(
  env: "prod" | "staging",
  object: TwentyObject,
  c: Company,
  campaign: string | null,
  dryRun: boolean,
  stats: Stats,
): Promise<void> {
  const meta = REST_META[object];
  const payload = FIELD_MAP[object](c, campaign);

  // Skip si le payload n'a aucune donnée exploitable (ex: people sans dirigeant).
  if (isEmptyPayload(object, payload)) {
    stats.skipped++;
    return;
  }

  const existingId = await lookupExisting(env, object, c);

  if (dryRun) {
    const verb = existingId ? "UPDATE" : "CREATE";
    console.log(`  [dry-run ${verb}] ${object} ← ${describeLead(c)}`);
    console.log(`             payload: ${JSON.stringify(payload)}`);
    if (existingId) stats.updated++;
    else stats.created++;
    return;
  }

  if (existingId) {
    const res = await twentyRest(env, "PATCH", `${meta.path}/${existingId}`, payload);
    if (res.ok) stats.updated++;
    else recordError(stats, c, res);
  } else {
    const res = await twentyRest(env, "POST", meta.path, payload);
    if (res.ok) stats.created++;
    else recordError(stats, c, res);
  }
}

/** Un payload est vide si le champ identifiant minimal manque. */
function isEmptyPayload(object: TwentyObject, payload: Record<string, unknown>): boolean {
  if (object === "companies") return !payload.siren && !payload.name;
  if (object === "people") {
    const name = payload.name as { firstName?: string; lastName?: string } | undefined;
    const hasName = !!(name?.firstName || name?.lastName);
    const hasEmail = !!(payload.emails as { primaryEmail?: string } | undefined)?.primaryEmail;
    return !hasName && !hasEmail; // rien à créer sans nom ni email
  }
  return !payload.name && !payload.societe;
}

function recordError(stats: Stats, c: Company, res: RestResult): void {
  stats.errors++;
  if (stats.errorSamples.length < 5) {
    stats.errorSamples.push(`${describeLead(c)} → HTTP ${res.status}: ${res.raw}`);
  }
}

function describeLead(c: Company): string {
  return `${str(c.denomination) || "?"} [${str(c.siren) || "no-siren"}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Bearer du search API (dédié, fallback tenant secret).
  const searchBearer =
    readCred("PROSPECTION_SEARCH_API_SECRET") || readCred("PROSPECTION_TENANT_API_SECRET");
  if (!searchBearer) {
    fail("PROSPECTION_TENANT_API_SECRET introuvable dans le vault (~/credentials/.all-creds.env)");
  }

  console.log(`→ Segment via ${args.apiUrl} (objet Twenty: ${args.object}, env: ${args.twentyEnv})`);
  if (args.dryRun) console.log("  MODE DRY-RUN — aucune écriture Twenty.\n");

  const segment = await fetchSegment(args, searchBearer);
  console.log(`→ ${segment.length} entreprise(s) récupérée(s) (limit ${args.limit}).\n`);

  if (segment.length === 0) {
    console.log("Rien à pousser. Fin.");
    return;
  }

  // Garde-fou : cold_prospects a une dédup faible → on prévient.
  if (args.object === "cold_prospects" && !args.dryRun) {
    console.warn(
      "⚠️  cold_prospects n'a pas de field siren : dédup best-effort par 'societe'. " +
        "Préférer --object companies (dédup stable par siren).\n",
    );
  }

  const stats: Stats = { created: 0, updated: 0, skipped: 0, errors: 0, errorSamples: [] };

  // Traitement séquentiel : respecte le rate-limit Twenty (pas de rafale).
  let i = 0;
  for (const company of segment) {
    i++;
    try {
      await upsertLead(args.twentyEnv, args.object, company, args.campaign, args.dryRun, stats);
    } catch (e) {
      stats.errors++;
      if (stats.errorSamples.length < 5) {
        stats.errorSamples.push(`${describeLead(company)} → exception: ${(e as Error).message}`);
      }
    }
    if (i % 50 === 0) console.log(`  … ${i}/${segment.length} traités`);
  }

  // ─── Résumé final ───
  console.log("\n─────────────────────────────────────────");
  console.log(`Objet Twenty   : ${args.object} (${args.twentyEnv})`);
  console.log(`Segment        : ${segment.length}`);
  console.log(`Créés          : ${stats.created}${args.dryRun ? " (dry-run)" : ""}`);
  console.log(`Mis à jour     : ${stats.updated}${args.dryRun ? " (dry-run)" : ""}`);
  console.log(`Skippés        : ${stats.skipped}`);
  console.log(`Erreurs        : ${stats.errors}`);
  if (stats.errorSamples.length > 0) {
    console.log("\nÉchantillon d'erreurs :");
    for (const s of stats.errorSamples) console.log(`  - ${s}`);
  }
  console.log("─────────────────────────────────────────");

  // Exit code scriptable : 0 si tout OK, 1 si au moins une erreur d'écriture.
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`✗ Fatal: ${(e as Error).stack || e}`);
  process.exit(2);
});
