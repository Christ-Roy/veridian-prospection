// STUB — Phase 3 SIREN refactor. Not yet implemented.
// Future equivalent of /api/outreach/[domain] (outreach CRUD, SIREN-centric).
// Spec: veridian-platform/MASTER_DB_SPEC.md + EMERGENCY-REFACTOR-SIREN-CENTRIC.md

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/user-context";

const SIREN_RE = /^\d{9}$/;

async function stub(params: Promise<{ siren: string }>) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { siren } = await params;
  if (!SIREN_RE.test(siren)) {
    return NextResponse.json({ error: "Invalid SIREN (expected 9 digits)" }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: "Not Implemented",
      todo: "SIREN refactor Phase 3 — outreach endpoint keyed by SIREN",
      siren,
    },
    { status: 501 }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siren: string }> }
) {
  return stub(params);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ siren: string }> }
) {
  return stub(params);
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ siren: string }> }
) {
  return stub(params);
}
