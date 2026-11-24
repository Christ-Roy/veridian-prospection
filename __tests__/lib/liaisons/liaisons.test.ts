/** Liaisons (VER-246) sans base : adresses où le jeton peut partir, drapeau, mise en forme, écran, garde de la route. */
import { beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({ ctx: null as unknown, fiche: vi.fn(), etat: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/user-context", () => ({ getUserContext: async () => m.ctx }));
vi.mock("@/lib/liaisons/session", () => ({ sessionId: async () => "s" }));
vi.mock("@/atlas/liaisons", async (o) => ({ ...(await o<typeof import("@/atlas/liaisons")>()), appelDe: async () => ({ a: 1 }), ficheVersCrm: (...x: unknown[]) => m.fiche(...x), etatLiaisons: (...x: unknown[]) => m.etat(...x) }));

import { NextRequest } from "next/server";

import { contactMail, envoiCrm, personne } from "@/atlas/liaisons";
import { GET, POST } from "@/app/api/liaisons/[action]/route";
import { RefusLiaison } from "@/lib/liaisons/erreurs";
import { liaisonOuverte } from "@/lib/liaisons/drapeau";
import { adresseSure, demanderJeton } from "@/lib/liaisons/hub";
import { appelerAction } from "@/lib/liaisons/action";
import { adresseRebond, BILAN_MAIL_VIDE, cumulerMail, envoisPossibles, lireReprise, phrasesMail, preparerRebond } from "@/components/atlas/liaisons-logique";

const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const T = "0891ed5a-4ce1-49ff-be3c-91628b357f4f";

test.each([
  ["https://crm.app.veridian.site/mcp", true],
  ["http://crm.app.veridian.site/mcp", false],
  ["https://veridian.site.mechant.fr/mcp", false],
  ["https://mechantveridian.site/mcp", false],
  ["https://u:p@crm.app.veridian.site/mcp", false],
  ["https://crm.app.veridian.site:8443/mcp", false],
  ["http://127.0.0.1:3000/mcp", false],
  ["javascript:alert(1)", false],
  [undefined, false],
])("en production, le jeton part vers %s : %s", (url, ok) => {
  expect(!!adresseSure(url, prod)).toBe(ok);
});

test("drapeau : éteint par défaut, par espace, jamais sans espace relié", () => {
  expect(liaisonOuverte("crm", T, undefined)).toBe(false);
  expect(liaisonOuverte("crm", T, "crm=*")).toBe(true);
  expect(liaisonOuverte("notifuse", T, "crm=*")).toBe(false);
  expect(liaisonOuverte("crm", T, `notifuse=*; crm = ${T.toUpperCase()},autre`)).toBe(true);
  expect(liaisonOuverte("crm", null, "crm=*")).toBe(false);
  for (const v of ["crm", "crm=", "crm==*", "crm=oui", "*", "crm:*"]) expect(liaisonOuverte("crm", T, v)).toBe(false);
});

describe("jeton d'action", () => {
  const env = { HUB_API_SECRET: "s", HUB_API_URL: "https://app.veridian.site", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
  const d = { poignee: "p".repeat(40), cible: "crm" as const, hubTenantId: T, motif: "x" };
  const rep = (corps: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(corps), { status }));
  const bon = { access_token: "j".repeat(40), tenant_id: T, url: "https://crm.app.veridian.site/mcp" };
  test("rend le jeton ; ne suit aucune redirection", async () => {
    const f = rep(bon);
    expect(await demanderJeton(d, { env, fetchImpl: f as unknown as typeof fetch })).toEqual({ jeton: bon.access_token, url: bon.url });
    expect((f.mock.calls as unknown as [string, RequestInit][])[0][1].redirect).toBe("error");
  });
  test.each([
    ["sans espace", { ...bon, tenant_id: undefined }, "autre_espace"],
    ["adresse étrangère", { ...bon, url: "https://mechant.fr" }, "hub_refus"],
    ["sans jeton", { ...bon, access_token: "" }, "hub_refus"],
    ["null", null, "hub_refus"],
  ])("réponse %s refusée", async (_n, corps, code) => {
    await expect(demanderJeton(d, { env, fetchImpl: rep(corps) as unknown as typeof fetch })).rejects.toMatchObject({ code });
  });
  test("Hub injoignable ou secret absent : rien ne part", async () => {
    await expect(demanderJeton(d, { env, fetchImpl: (async () => { throw new Error("x"); }) as unknown as typeof fetch })).rejects.toMatchObject({ code: "hub_injoignable" });
    await expect(demanderJeton(d, { env: {} as NodeJS.ProcessEnv, fetchImpl: rep(bon) as unknown as typeof fetch })).rejects.toMatchObject({ code: "config" });
  });
  test("aucun message ne porte la poignée ni le jeton", async () => {
    const traces: string[] = [];
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...x) => void traces.push(x.join(" ")));
    await demanderJeton(d, { env, fetchImpl: rep({ error: d.poignee }, 403) as unknown as typeof fetch }).catch((e) => traces.push(String(e.message)));
    await appelerAction({ jeton: bon.access_token, url: bon.url }, "crm", "x", {}, "k", { fetchImpl: rep({ error: "refus" }, 403) as unknown as typeof fetch }).catch((e) => traces.push(String(e.message)));
    vi.restoreAllMocks();
    expect(traces.join("\n")).not.toContain(bon.access_token);
    expect(traces.some((x) => x.includes("https://crm"))).toBe(false);
  });
});

test("réponse de plus de 2 Mo coupée, réponse illisible refusée", async () => {
  const a = { jeton: "j", url: "https://crm.app.veridian.site/mcp" };
  await expect(appelerAction(a, "crm", "x", {}, "k", { fetchImpl: (async () => new Response("x".repeat(2_100_000))) as unknown as typeof fetch })).rejects.toMatchObject({ code: "reponse_invalide" });
  await expect(appelerAction(a, "crm", "x", {}, "k", { fetchImpl: (async () => new Response("<html>")) as unknown as typeof fetch })).rejects.toBeInstanceOf(RefusLiaison);
});

test("dirigeant : jamais un prénom deviné", () => {
  expect(personne("CAROLE GABARROCA")).toEqual({ prenom: "CAROLE", nom: "GABARROCA" });
  expect(personne("JEAN-FRANÇOIS CLAIRON")).toEqual({ prenom: "JEAN-FRANÇOIS", nom: "CLAIRON" });
  expect(personne("FANNY MONNIER (AMIDIEU DU CLOS)")).toEqual({ prenom: "FANNY", nom: "MONNIER" });
  expect(personne("JEAN DE LA TOUR")).toEqual({ nom: "JEAN DE LA TOUR" });
  expect(personne("VERDIER HOLDING")).toEqual({});
  expect(personne("JEAN-PAUL ABALAN ET ASSOCIES")).toEqual({});
  expect(personne(null)).toEqual({});
});

const LIGNE = { siren: "123456789", email: "a@b.fr", domaine: null, raison_sociale: "SA", dirigeant: null, role_dirigeant: "Gérant", activite: null, naf: null, code_postal: null, commune: "LYON", departement: "69", telephone: null };
test("sans dirigeant ni email : société seule ; aucun champ vide envoyé ; le téléphone reste dans la note d'appel", () => {
  expect(envoiCrm({ ...LIGNE, email: null })).not.toHaveProperty("contact");
  expect(JSON.stringify(envoiCrm({ ...LIGNE, email: null, telephone: "0400000000" }))).toContain("Téléphone : 0400000000");
  expect(Object.values(contactMail(LIGNE, "S")).every((v) => v !== null && v !== "")).toBe(true);
  expect(contactMail(LIGNE, "S")).not.toHaveProperty("job_title");
});

describe("route", () => {
  const url = "http://localhost/api/liaisons/crm-fiche";
  const p = (action: string) => ({ params: Promise.resolve({ action }) });
  const corps = { geste: T, siren: "123456789" };
  const req = (b: unknown = corps, h: Record<string, string> = {}) => new NextRequest(url, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json", ...h } });
  beforeEach(() => {
    m.ctx = { userId: `u${Math.random()}`, tenantId: "t" };
    m.fiche.mockReset().mockResolvedValue({ sort: "cree" });
    m.etat.mockReset().mockResolvedValue({ crm: false });
  });
  test("un geste de l'écran passe", async () => {
    expect((await POST(req(corps, { "sec-fetch-site": "same-origin" }), p("crm-fiche"))).status).toBe(200);
  });
  test.each([
    ["autre site", { "sec-fetch-site": "cross-site" }],
    ["sous-domaine voisin", { "sec-fetch-site": "same-site" }],
    ["formulaire", { "content-type": "text/plain" }],
  ])("%s : refusé", async (_n, h) => {
    expect((await POST(req(corps, h as Record<string, string>), p("crm-fiche"))).status).toBe(403);
    expect(m.fiche).not.toHaveBeenCalled();
  });
  test("sans session, action inconnue, prototype, demande étrangère", async () => {
    expect((await POST(req(), p("inconnue"))).status).toBe(404);
    expect((await POST(req(), p("constructor"))).status).toBe(404);
    expect((await POST(req({ ...corps, tenantId: "autre" }), p("crm-fiche"))).status).toBe(400);
    expect((await POST(req({ ...corps, siren: "1" }), p("crm-fiche"))).status).toBe(400);
    m.ctx = null;
    expect((await POST(req(), p("crm-fiche"))).status).toBe(401);
    expect((await GET(new NextRequest(url), p("etat"))).status).toBe(401);
    expect(m.fiche).not.toHaveBeenCalled();
  });
  test("un refus garde son code et son attente ; une erreur interne ne dit rien de l'intérieur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.fiche.mockRejectedValueOnce(new RefusLiaison("plafond", "Patientez.", 429, 30));
    const r = await POST(req(), p("crm-fiche"));
    expect([r.status, r.headers.get("retry-after"), await r.json()]).toEqual([429, "30", { error: "Patientez.", code: "plafond", attendre: 30 }]);
    m.fiche.mockRejectedValueOnce(new Error("postgres://secret"));
    const x = await POST(req(), p("crm-fiche"));
    expect(x.status).toBe(500);
    expect(await x.text()).not.toContain("postgres");
    vi.restoreAllMocks();
  });
});

describe("rebond", () => {
  const memoire = () => {
    const v = new Map<string, string>();
    return { getItem: (k: string) => v.get(k) ?? null, setItem: (k: string, x: string) => void v.set(k, x), removeItem: (k: string) => void v.delete(k) };
  };
  test("un seul par fenêtre de 5 minutes, repris une fois, oublié après 10", () => {
    const s = memoire();
    const r = { type: "fiche" as const, siren: "123456789", nom: "N" };
    expect(preparerRebond(r, s, 1_000_000)).toBe(true);
    expect(preparerRebond(r, s, 1_100_000)).toBe(false);
    expect(lireReprise(s, 1_100_000)).toMatchObject(r);
    expect(lireReprise(s, 1_100_000)).toBeNull();
    expect(preparerRebond(r, s, 1_400_000)).toBe(true);
    expect(lireReprise(s, 3_000_000)).toBeNull();
    expect(preparerRebond(r, null)).toBe(false);
  });
  test("le retour est encodé", () => {
    expect(adresseRebond("https://hub", "https://a/?x=1&y=2")).toBe("https://hub/api/auth/bounce/prepare?next=https%3A%2F%2Fa%2F%3Fx%3D1%26y%3D2&auto=1");
  });
});

test("bilan Mail : les motifs s'additionnent d'une page à l'autre et se lisent", () => {
  const page = { recus: 10, crees: 7, existants: 1, inscrits: 7, ecartes: { unsubscribed: 2, motif_neuf: 1 }, declenche: false, total: 20, retirees: 1, curseur_suivant: null };
  const b = cumulerMail(cumulerMail(BILAN_MAIL_VIDE, page), { ...page, declenche: true });
  expect(b).toMatchObject({ recus: 20, crees: 14, ecartes: { unsubscribed: 4, motif_neuf: 2 }, declenche: true });
  expect(phrasesMail(b, true).join(" | ")).toBe("14 nouveaux contacts à créer | 2 contacts déjà dans Mail, fiche laissée intacte | Écartés par Mail (désinscrits : 4, motif neuf : 2) | 2 entreprises retirées, plus contactables");
  expect(phrasesMail({ ...b, crees: 1 }, false)[0]).toBe("1 nouveau contact créé");
});

test("fiche : seuls les envois qui peuvent aboutir se montrent", () => {
  const etat = { crm: true, notifuse: true, payant: true, connexion: true };
  expect(envoisPossibles({ contact: { email_envoyable: 1 } }, etat)).toEqual({ crm: true, notifuse: true });
  expect(envoisPossibles({ contact: { email: "a@b.fr", email_envoyable: 0 } }, etat)).toEqual({ crm: true, notifuse: false });
  expect(envoisPossibles({ contact: { email_envoyable: 1 }, qualite: { blocages: ["cessee"] } }, etat)).toEqual({ crm: false, notifuse: false });
  expect(envoisPossibles({ contact: { email_connu: true, prospectable: true } }, etat)).toEqual({ crm: false, notifuse: false });
  expect(envoisPossibles({ contact: { email_envoyable: 1 } }, { ...etat, crm: false, notifuse: false })).toEqual({ crm: false, notifuse: false });
});
