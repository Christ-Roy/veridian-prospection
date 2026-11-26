/**
 * CONTRAT-HUB §5.24.1 : Prospection demande l'état de « Mon IA » au Hub (signé ts.nonce.corps) et n'affiche le cadre que
 * s'il répond `prete`. Sans moteur : la carte. Éteinte, refus, Hub muet ou réponse illisible : rien.
 */
import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";

import { affichageMonIA, etatMonIA } from "@/lib/hub/ia-etat";

const env = { HUB_API_SECRET: "s".repeat(40), HUB_API_URL: "https://app.veridian.site" } as unknown as NodeJS.ProcessEnv;
let n = 0;
const ids = () => [`u-${++n}`, `t-${n}`] as const;
const repondre = (status: number, corps: unknown, vus: Request[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    vus.push(new Request(url, init));
    return new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("affichage", () => {
  test("prete → cadre, sans_moteur → carte (jamais le cadre), le reste → rien", () => {
    expect(affichageMonIA("prete")).toBe("cadre");
    expect(affichageMonIA("sans_moteur")).toBe("carte");
    expect(affichageMonIA("eteinte")).toBeNull();
    expect(affichageMonIA(null)).toBeNull();
    expect(affichageMonIA(undefined)).toBeNull();
  });
});

describe("lecture de l'état au Hub", () => {
  test("appel signé comme /api/organisations/lire : app, horodatage, nonce, HMAC de ts.nonce.corps", async () => {
    const vus: Request[] = [];
    const [u, t] = ids();
    expect(await etatMonIA(u, t, { env, fetchImpl: repondre(200, { etat: "sans_moteur" }, vus) })).toBe("sans_moteur");
    const r = vus[0];
    expect(r.url).toBe("https://app.veridian.site/api/ia/etat");
    expect(r.method).toBe("POST");
    const corps = await r.text();
    expect(JSON.parse(corps)).toEqual({ hub_user_id: u, tenant_id: t });
    const ts = r.headers.get("x-veridian-timestamp")!, nonce = r.headers.get("x-veridian-nonce")!;
    expect(r.headers.get("x-veridian-app")).toBe("prospection");
    expect(r.headers.get("x-veridian-hub-signature")).toBe(createHmac("sha256", env.HUB_API_SECRET!).update(`${ts}.${nonce}.${corps}`).digest("hex"));
  });

  test.each([
    ["prete", 200, { etat: "prete" }, "prete"],
    ["eteinte", 200, { etat: "eteinte" }, "eteinte"],
    ["état inconnu", 200, { etat: "autre" }, null],
    ["404 espace_inconnu", 404, { error: "espace_inconnu" }, null],
    ["401 signature", 401, { error: "invalid_signature" }, null],
    ["500", 500, {}, null],
  ])("%s", async (_nom, status, corps, attendu) => {
    const [u, t] = ids();
    expect(await etatMonIA(u, t, { env, fetchImpl: repondre(status, corps) })).toBe(attendu);
  });

  test("Hub injoignable ou secret absent : rien, sans lever", async () => {
    const [u, t] = ids();
    const muet = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect(await etatMonIA(u, t, { env, fetchImpl: muet })).toBeNull();
    const [u2, t2] = ids();
    expect(await etatMonIA(u2, t2, { env: {} as NodeJS.ProcessEnv, fetchImpl: repondre(200, { etat: "prete" }) })).toBeNull();
  });

  test("gardé 60 s au plus pour une même personne et organisation, puis relu", async () => {
    const vus: Request[] = [];
    const [u, t] = ids();
    let h = 1_000_000;
    const o = { env, maintenant: () => h };
    expect(await etatMonIA(u, t, { ...o, fetchImpl: repondre(200, { etat: "sans_moteur" }, vus) })).toBe("sans_moteur");
    h += 59_000;
    expect(await etatMonIA(u, t, { ...o, fetchImpl: repondre(200, { etat: "prete" }, vus) })).toBe("sans_moteur");
    h += 2_000;
    expect(await etatMonIA(u, t, { ...o, fetchImpl: repondre(200, { etat: "prete" }, vus) })).toBe("prete");
    expect(vus).toHaveLength(2);
  });
});
