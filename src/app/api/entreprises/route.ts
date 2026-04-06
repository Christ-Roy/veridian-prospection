// GET /api/entreprises — liste paginée des prospects SIREN-centric
//
// Query params:
//   ?limit=50&offset=0
//   ?sort=prospect_score|denomination|chiffre_affaires|date_creation  (default: prospect_score)
//   ?dir=asc|desc  (default: desc)
//   ?q=texte                 → fuzzy search via pg_trgm ILIKE
//   ?departement=75,92       → CSV list
//   ?secteur=BTP,SANTE       → CSV list of secteur_final values
//   ?rge=true                → est_rge filter
//   ?qualiopi=true           → est_qualiopi filter
//   ?bio=true                → est_bio filter
//   ?score_min=60            → prospect_score >= X
//   ?ca_min=500000           → chiffre_affaires >= X
//   ?has_phone=true          → best_phone_e164 NOT NULL
//   ?has_website=false       → web_domain IS NULL
//   ?include_auto=false      → exclude auto-entrepreneurs (default true = include them)
//
// Always applies: is_registrar = false, NOT COALESCE(ca_suspect, false)
//
// Response: { total, rows: [...], limit, offset }

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/user-context";
import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type SortField = "prospect_score" | "denomination" | "chiffre_affaires" | "date_creation";
const ALLOWED_SORTS: Record<SortField, keyof Prisma.EntrepriseOrderByWithRelationInput> = {
  prospect_score: "prospectScore",
  denomination: "denomination",
  chiffre_affaires: "chiffreAffaires",
  date_creation: "dateCreation",
};

const SELECT_FIELDS = {
  siren: true,
  denomination: true,
  sigle: true,
  codeNaf: true,
  nafLibelle: true,
  secteurFinal: true,
  domaineFinal: true,
  commune: true,
  codePostal: true,
  departement: true,
  bestPhoneE164: true,
  bestPhoneType: true,
  bestEmailNormalized: true,
  bestEmailType: true,
  webDomainNormalized: true,
  webDomainCount: true,
  dirigeantPrenom: true,
  dirigeantNom: true,
  dirigeantQualite: true,
  chiffreAffaires: true,
  resultatNet: true,
  trancheEffectifs: true,
  categorieEntreprise: true,
  dateCreation: true,
  estRge: true,
  estQualiopi: true,
  estBio: true,
  estEpv: true,
  estFiness: true,
  estBni: true,
  estSurLbc: true,
  nbMarchesPublics: true,
  montantMarchesPublics: true,
  decp2024Plus: true,
  webTechScore: true,
  webEclateScore: true,
  prospectScore: true,
  prospectTier: true,
  isAutoEntrepreneur: true,
  signalCount: true,
} satisfies Prisma.EntrepriseSelect;

function parseBool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function parseCsv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const sp = new URL(request.url).searchParams;

  // Pagination
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 500);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  // Sort
  const sortParam = (sp.get("sort") ?? "prospect_score") as SortField;
  const sortField = ALLOWED_SORTS[sortParam] ?? "prospectScore";
  const dir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : "desc";

  // Filters
  // Always applied: is_registrar = false, NOT caSuspect=true (nulls pass through)
  const where: Prisma.EntrepriseWhereInput = {
    isRegistrar: false,
    NOT: { caSuspect: true },
  };

  const q = sp.get("q");
  if (q) {
    where.denomination = { contains: q, mode: "insensitive" };
  }

  const depts = parseCsv(sp.get("departement"));
  if (depts) where.departement = { in: depts };

  const secteurs = parseCsv(sp.get("secteur"));
  if (secteurs) where.secteurFinal = { in: secteurs };

  const rge = parseBool(sp.get("rge"));
  if (rge !== undefined) where.estRge = rge;
  const qualiopi = parseBool(sp.get("qualiopi"));
  if (qualiopi !== undefined) where.estQualiopi = qualiopi;
  const bio = parseBool(sp.get("bio"));
  if (bio !== undefined) where.estBio = bio;

  const scoreMin = parseInt(sp.get("score_min") ?? "", 10);
  if (!isNaN(scoreMin)) where.prospectScore = { gte: scoreMin };

  const caMin = parseInt(sp.get("ca_min") ?? "", 10);
  if (!isNaN(caMin)) where.chiffreAffaires = { gte: BigInt(caMin) };

  const hasPhone = parseBool(sp.get("has_phone"));
  if (hasPhone === true) where.bestPhoneE164 = { not: null };
  if (hasPhone === false) where.bestPhoneE164 = null;

  const hasWebsite = parseBool(sp.get("has_website"));
  if (hasWebsite === true) where.webDomain = { not: null };
  if (hasWebsite === false) where.webDomain = null;

  const includeAuto = parseBool(sp.get("include_auto"));
  if (includeAuto === false) where.isAutoEntrepreneur = { not: true };

  // Execute
  let total: number;
  type Row = Prisma.EntrepriseGetPayload<{ select: typeof SELECT_FIELDS }>;
  let rows: Row[];
  try {
    [total, rows] = await Promise.all([
      prisma.entreprise.count({ where }),
      prisma.entreprise.findMany({
        where,
        orderBy: [{ [sortField]: dir }, { siren: "asc" }],
        take: limit,
        skip: offset,
        select: SELECT_FIELDS,
      }),
    ]);
  } catch (err) {
    console.error("[api/entreprises] Prisma error:", err);
    return NextResponse.json(
      {
        error: "Query failed",
        message: err instanceof Error ? err.message : String(err),
        where_debug: JSON.stringify(where, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
      },
      { status: 500 }
    );
  }

  // BigInt → number for JSON serialization
  const serialized = rows.map((r) => ({
    ...r,
    chiffreAffaires: r.chiffreAffaires === null ? null : Number(r.chiffreAffaires),
    resultatNet: r.resultatNet === null ? null : Number(r.resultatNet),
    montantMarchesPublics: r.montantMarchesPublics === null ? null : Number(r.montantMarchesPublics),
  }));

  return NextResponse.json(
    {
      total,
      rows: serialized,
      limit,
      offset,
      sort: sortParam,
      dir,
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}
