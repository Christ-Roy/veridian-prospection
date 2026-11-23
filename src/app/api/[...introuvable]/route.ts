/**
 * Toute route d'API inconnue répond un 404 en JSON. Sans elle, Next sert sa page 404 en HTML, et un client qui
 * attend du JSON (le Hub, un script, une IA) lit « Unexpected token '<' » au lieu d'un refus clair (23/11, batterie
 * système du Hub sur /api/trial). Les routes existantes, plus précises, passent toujours avant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const introuvable = async () => NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export const GET = introuvable;
export const POST = introuvable;
export const PUT = introuvable;
export const PATCH = introuvable;
export const DELETE = introuvable;
