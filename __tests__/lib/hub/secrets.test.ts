/**
 * Secret du Hub renouvelable sans coupure (VER-251) : le courant ou un second facultatif vérifient, le courant seul
 * signe. Un second absent, vide ou court ne valide rien, même une signature faite avec ce vide.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SECOND_MIN, secretCourant, secretSecond, verifierAppelHub, verifierSignature } from "@/lib/hub/secrets";
import { HUB_TIMESTAMP_DRIFT_MS } from "@/lib/hub/hmac";
import { demanderJeton } from "@/lib/liaisons/hub";

const COURANT = "courant-".repeat(6), SECOND = "second-".repeat(6), TIERS = "tiers-".repeat(8);
const signer = (secret: string, ts: number, corps = "{}") => createHmac("sha256", secret).update(`${ts}.${corps}`).digest("hex");
const env = (o: Record<string, string | undefined> = {}) => ({ TENANT_API_SECRET: COURANT, ...o });
const juger = (secret: string, e: Record<string, string | undefined>, ts = Date.now()) => verifierSignature(ts, "{}", signer(secret, ts), e);

describe("vérification", () => {
  test("le courant, avec ou sans second", () => {
    expect(juger(COURANT, env())).toEqual({ ok: true, cle: "courant" });
    expect(juger(COURANT, env({ HUB_API_SECRET_SECOND: SECOND }))).toEqual({ ok: true, cle: "courant" });
  });
  test("le second, quand il est posé ; un tiers jamais", () => {
    expect(juger(SECOND, env({ HUB_API_SECRET_SECOND: SECOND }))).toEqual({ ok: true, cle: "second" });
    expect(juger(SECOND, env())).toEqual({ ok: false, reason: "invalid_signature" });
    expect(juger(TIERS, env({ HUB_API_SECRET_SECOND: SECOND }))).toEqual({ ok: false, reason: "invalid_signature" });
  });
  test.each([["absent", undefined], ["vide", ""], ["espaces", " ".repeat(40)], ["court", "x".repeat(SECOND_MIN - 1)], ["« <no value> » de Nomad", "<no value>"]])("second %s : ne valide rien, pas même ce qu'il signe", (_n, v) => {
    const e = env({ HUB_API_SECRET_SECOND: v });
    expect(secretSecond(e)).toBeUndefined();
    for (const s of ["", v ?? "", "undefined"]) expect(juger(s, e)).toEqual({ ok: false, reason: "invalid_signature" });
    expect(juger(COURANT, e)).toEqual({ ok: true, cle: "courant" });
  });
  test("sans courant, rien ne passe, même signé par le second ou par le vide", () => {
    for (const e of [{ HUB_API_SECRET_SECOND: SECOND }, { TENANT_API_SECRET: "", HUB_API_SECRET: "", HUB_API_SECRET_SECOND: SECOND }]) {
      expect(secretCourant(e)).toBeUndefined();
      for (const s of ["", SECOND]) expect(juger(s, e)).toEqual({ ok: false, reason: "missing_secret" });
    }
  });
  test("bascule : l'ancien devient second, puis disparaît", () => {
    const apres = { TENANT_API_SECRET: SECOND, HUB_API_SECRET_SECOND: COURANT };
    expect(juger(SECOND, apres)).toMatchObject({ cle: "courant" });
    expect(juger(COURANT, apres)).toMatchObject({ cle: "second" });
    expect(juger(COURANT, { TENANT_API_SECRET: SECOND })).toMatchObject({ ok: false });
  });
  test("HUB_API_SECRET prime sur TENANT_API_SECRET, qui ne valide plus rien", () => {
    expect(juger(COURANT, { HUB_API_SECRET: SECOND, TENANT_API_SECRET: COURANT })).toMatchObject({ ok: false });
  });
  test("corps modifié, horodatage périmé ou illisible, signature mal formée : refus, par l'un comme par l'autre secret", () => {
    const e = env({ HUB_API_SECRET_SECOND: SECOND });
    const ts = Date.now();
    for (const s of [COURANT, SECOND]) {
      expect(verifierSignature(ts, "{ }", signer(s, ts), e)).toEqual({ ok: false, reason: "invalid_signature" });
      const vieux = ts - HUB_TIMESTAMP_DRIFT_MS - 1000;
      expect(verifierSignature(vieux, "{}", signer(s, vieux), e)).toEqual({ ok: false, reason: "timestamp_drift" });
      expect(verifierSignature(NaN, "{}", signer(s, ts), e)).toEqual({ ok: false, reason: "invalid_timestamp" });
      expect(verifierSignature(ts, "{}", `${signer(s, ts)}zz`, e)).toEqual({ ok: false, reason: "invalid_signature" });
      expect(verifierSignature(ts, "{}", signer(s, ts).slice(0, 62), e)).toEqual({ ok: false, reason: "invalid_signature" });
    }
    expect(verifierSignature(ts, "{}", "", e)).toEqual({ ok: false, reason: "missing_signature" });
    expect(verifierSignature(ts, "{}", "zz".repeat(32), e)).toEqual({ ok: false, reason: "invalid_signature" });
  });
});

describe("appel du Hub", () => {
  const traces: string[] = [];
  beforeEach(() => {
    traces.length = 0;
    for (const k of ["log", "warn"] as const) vi.spyOn(console, k).mockImplementation((...x) => void traces.push(x.join(" ")));
    vi.stubEnv("TENANT_API_SECRET", COURANT);
    vi.stubEnv("HUB_API_SECRET", "");
    vi.stubEnv("HUB_API_SECRET_SECOND", SECOND);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const req = (secret: string, h: Record<string, string> = {}) => {
    const ts = Date.now();
    return new NextRequest("https://x/api/users/by-email?email=client@exemple.fr", { headers: { "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": signer(secret, ts, ""), "x-forwarded-for": "203.0.113.7, 10.0.0.1", ...h } });
  };
  test("trace la provenance et le secret employé, sans secret, signature, ni adresse de la requête", () => {
    expect(verifierAppelHub(req(SECOND), "").ok).toBe(true);
    expect(verifierAppelHub(req(TIERS), "").ok).toBe(false);
    expect(traces).toEqual(["[hub-hmac] accepte cle=second chemin=/api/users/by-email ip=203.0.113.7, 10.0.0.1", "[hub-hmac] refus motif=invalid_signature chemin=/api/users/by-email ip=203.0.113.7, 10.0.0.1"]);
  });
  test("une adresse forgée n'écrit pas de fausse ligne au journal", () => {
    verifierAppelHub(req(TIERS, { "x-forwarded-for": "1.2.3.4 [hub-hmac] accepte cle=courant" }), "");
    expect(traces).toHaveLength(1);
    expect(traces[0]).not.toMatch(/ip=.*(accepte|hub-hmac)/);
  });
  test("sans en-têtes : refus", () => {
    expect(verifierAppelHub(new NextRequest("https://x/api/y"), "")).toMatchObject({ ok: false });
  });
  test("on signe toujours avec le courant, jamais avec le second", async () => {
    let vu: Record<string, string> = {};
    await demanderJeton({ poignee: "p".repeat(40), cible: "crm", hubTenantId: "t", motif: "x" }, { fetchImpl: (async (_u: string, o: RequestInit) => ((vu = { ...(o.headers as Record<string, string>), corps: String(o.body) }), new Response("{}", { status: 403 }))) as unknown as typeof fetch }).catch(() => undefined);
    const avec = (s: string) => createHmac("sha256", s).update(`${vu["X-Veridian-Timestamp"]}.${vu["X-Veridian-Nonce"]}.${vu.corps}`).digest("hex");
    expect(vu["X-Veridian-Hub-Signature"]).toBe(avec(COURANT));
    expect(vu["X-Veridian-Hub-Signature"]).not.toBe(avec(SECOND));
  });
});

test("un seul endroit lit le secret du Hub et vérifie sa signature", () => {
  const racine = path.resolve(__dirname, "../../../src");
  const fichiers = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? fichiers(path.join(d, f)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [path.join(d, f)] : []));
  const tous = fichiers(racine).map((f) => [path.relative(racine, f), readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")] as const);
  expect(tous.length).toBeGreaterThan(100);
  expect(tous.filter(([, s]) => /(HUB|TENANT)_API_SECRET/.test(s)).map(([f]) => f)).toEqual(["lib/hub/secrets.ts"]);
  // Toute route qui regarde la signature du Hub passe par la vérification commune.
  for (const [f, s] of tous) if (f.startsWith("app/") && /x-veridian-hub-signature/i.test(s)) expect(`${f} ${/verifierAppelHub\(/.test(s)}`).toBe(`${f} true`);
  expect(tous.filter(([, s]) => /verifierAppelHub\(request/.test(s)).length).toBeGreaterThanOrEqual(5);
});
