/**
 * Jeton du Hub vers le MCP de Prospection (CONTRAT-MCP §2) : seule une signature ES256 du Hub,
 * destinée à cette URL, non expirée, sur une adresse prouvée, ouvre la porte.
 */
import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { _viderCacheJwks, verifierJetonHub } from "@/lib/mcp/jeton-hub";

const ENV = { HUB_MCP_ISSUER: "https://hub.test", MCP_PUBLIC_URL: "https://prospection.test/api/mcp" } as unknown as NodeJS.ProcessEnv;
const MAINTENANT = Date.UTC(2026, 10, 9, 12, 0, 0);
const SUB = "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f";

type Paire = { privee: CryptoKey; publique: JsonWebKey & { kid: string } };
async function paire(kid: string): Promise<Paire> {
  const k = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = (await webcrypto.subtle.exportKey("jwk", k.publicKey)) as JsonWebKey;
  return { privee: k.privateKey, publique: { ...pub, kid } };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function signer(p: Paire, claims: Record<string, unknown>, entete: Record<string, unknown> = {}) {
  const h = b64({ alg: "ES256", typ: "JWT", kid: p.publique.kid, ...entete });
  const c = b64(claims);
  const sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, p.privee, Buffer.from(`${h}.${c}`));
  return `${h}.${c}.${Buffer.from(sig).toString("base64url")}`;
}
const claims = (o: Record<string, unknown> = {}) => ({
  iss: "https://hub.test",
  aud: "https://prospection.test/api/mcp",
  sub: SUB,
  email: "robert@exemple.fr",
  email_verified: true,
  scope: "mcp",
  client_id: "claude",
  jti: "j-1",
  iat: MAINTENANT / 1000,
  exp: MAINTENANT / 1000 + 300,
  ...o,
});
function jwks(...cles: Paire[]) {
  return vi.fn(async () => new Response(JSON.stringify({ keys: cles.map((c) => ({ ...c.publique, alg: "ES256", use: "sig" })) })));
}

let hub: Paire;
beforeEach(async () => {
  _viderCacheJwks();
  hub = await paire("hub-1");
});

describe("verifierJetonHub", () => {
  test("accepte un jeton du Hub pour cette app et rend hub_user_id", async () => {
    const id = await verifierJetonHub(await signer(hub, claims()), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT });
    expect(id).toEqual({ hubUserId: SUB, email: "robert@exemple.fr", scope: "mcp", clientId: "claude", clientNom: null, jti: "j-1", tenantId: null });
  });

  test("rend le nom du client quand le Hub le donne (affichage seulement)", async () => {
    const id = await verifierJetonHub(await signer(hub, claims({ client_name: "  Claude  " })), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT });
    expect(id.clientNom).toBe("Claude");
    const vide = await verifierJetonHub(await signer(hub, claims({ client_name: 42 })), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT });
    expect(vide.clientNom).toBeNull();
  });

  test("rend le tenant_id signé, et ignore une valeur qui n'est pas un identifiant", async () => {
    const T = "9b2d1c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";
    const avec = await verifierJetonHub(await signer(hub, claims({ tenant_id: T })), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT });
    expect(avec.tenantId).toBe(T);
    const brut = await verifierJetonHub(await signer(hub, claims({ tenant_id: "mon-espace" })), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT });
    expect(brut.tenantId).toBeNull();
  });

  test.each([
    ["destiné à une autre app", { aud: "https://notifuse.test/api/mcp" }, /autre app/],
    ["émis par un autre que le Hub", { iss: "https://pirate.test" }, /émetteur/],
    ["expiré", { exp: MAINTENANT / 1000 - 120 }, /expiré/],
    ["sans adresse prouvée", { email_verified: false }, /adresse/],
    ["dont le sujet n'est pas un hub_user_id", { sub: "cuid123" }, /sujet/],
  ])("refuse un jeton %s", async (_cas, o, motif) => {
    await expect(
      verifierJetonHub(await signer(hub, claims(o)), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT }),
    ).rejects.toThrow(motif);
  });

  test("refuse un jeton signé par une autre clé portant le kid du Hub", async () => {
    const pirate = await paire("hub-1");
    await expect(
      verifierJetonHub(await signer(pirate, claims()), { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT }),
    ).rejects.toThrow(/signature invalide/);
  });

  test("refuse une charge modifiée après signature", async () => {
    const [h, , s] = (await signer(hub, claims())).split(".");
    const falsifie = `${h}.${b64(claims({ sub: "11111111-2222-4333-8444-555555555555" }))}.${s}`;
    await expect(verifierJetonHub(falsifie, { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT })).rejects.toThrow(/signature invalide/);
  });

  test("refuse alg none et HS256", async () => {
    for (const alg of ["none", "HS256"]) {
      const jeton = `${b64({ alg, kid: "hub-1" })}.${b64(claims())}.`;
      await expect(verifierJetonHub(jeton, { env: ENV, fetchImpl: jwks(hub), maintenant: MAINTENANT })).rejects.toThrow(/algorithme/);
    }
  });

  test("relit le JWKS une fois quand le Hub change de clé, pas à chaque jeton inconnu", async () => {
    const nouvelle = await paire("hub-2");
    let cles = [hub];
    const f = vi.fn(async () => new Response(JSON.stringify({ keys: cles.map((c) => c.publique) })));
    await verifierJetonHub(await signer(hub, claims()), { env: ENV, fetchImpl: f, maintenant: MAINTENANT });
    cles = [hub, nouvelle];
    await verifierJetonHub(await signer(nouvelle, claims()), { env: ENV, fetchImpl: f, maintenant: MAINTENANT + 120_000 });
    expect(f).toHaveBeenCalledTimes(2);
    const inconnue = await paire("hub-9");
    await expect(
      verifierJetonHub(await signer(inconnue, claims()), { env: ENV, fetchImpl: f, maintenant: MAINTENANT + 130_000 }),
    ).rejects.toThrow(/clé de signature inconnue/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  test("Hub injoignable : refus, jamais d'acceptation par défaut", async () => {
    const f = vi.fn(async () => new Response("<html>", { status: 404 }));
    await expect(verifierJetonHub(await signer(hub, claims()), { env: ENV, fetchImpl: f, maintenant: MAINTENANT })).rejects.toThrow(/injoignables/);
  });
});
