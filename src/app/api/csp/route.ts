/** Réception des violations de la CSP (VER-265) : une ligne `csp_violation` par rapport, jamais d'erreur rendue au navigateur. */
import { CHEMIN_RAPPORT, resumerRapport } from "@/lib/csp";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const vide = () => new Response(null, { status: 204 });

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "inconnue";
  if (isRateLimited(`csp:${ip}`, 30, 60_000)) return vide();
  const texte = await req.text().catch(() => "");
  if (!texte || texte.length > 16_384) return vide();
  let brut: unknown = null;
  try {
    brut = JSON.parse(texte);
  } catch {
    return vide();
  }
  for (const v of resumerRapport(brut)) console.warn(JSON.stringify({ evenement: "csp_violation", a: new Date().toISOString(), rapport: CHEMIN_RAPPORT, ...v }));
  return vide();
}
