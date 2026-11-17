/**
 * Accès avancé : le garde SQL refuse tout ce qui n'est pas une lecture des trois tables d'ODH, les SIREN collés
 * se normalisent, le quota de vérification tient, les clés API ne valent que hachées, actives, et dans un
 * espace qui garde l'accès avancé.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
});
const db = vi.hoisted(() => ({
  cles: [] as Record<string, unknown>[],
  tenants: new Map<string, { accesAvance: boolean; plan: string | null }>(),
  users: new Map<string, { id: string; email: string; atlasAdmin: boolean }>(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: async ({ where }: { where: { id: string } }) => db.tenants.get(where.id) ?? null },
    user: { findUnique: async ({ where }: { where: { id: string } }) => db.users.get(where.id) ?? null },
    atlasCleApi: {
      count: async () => db.cles.filter((c) => !c.revoqueeLe).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const c = { id: `c${db.cles.length}`, creeLe: new Date(), revoqueeLe: null, ...data };
        db.cles.push(c);
        return c;
      },
      findUnique: async ({ where }: { where: { empreinte: string } }) => db.cles.find((c) => c.empreinte === where.empreinte) ?? null,
      update: async () => ({}),
      updateMany: async ({ where }: { where: { id: string } }) => {
        const c = db.cles.find((x) => x.id === where.id && !x.revoqueeLe);
        if (c) c.revoqueeLe = new Date();
        return { count: c ? 1 : 0 };
      },
    },
  },
}));
vi.mock("@/lib/auth/user-context", () => ({
  buildUserContext: async (u: { id: string; email: string }, _c: unknown, tenantId: string) => ({ userId: u.id, email: u.email, tenantId, workspaces: [], isAdmin: true }),
}));

import { verifierRequete } from "@/atlas/sql";
import { contexteDepuisCle, creerCle, empreinte, oublierDroits, revoquerCle } from "@/atlas/acces";
import { normaliserSirens, QUOTA_VERIFICATION, reserverVerification } from "@/atlas/outils-mcp";
import { outilsVisibles } from "@/lib/mcp/outils";

describe("garde SQL", () => {
  const ok = (q: string) => expect(() => verifierRequete(q)).not.toThrow();
  const ko = (q: string, motif: RegExp) => expect(() => verifierRequete(q)).toThrow(motif);

  test("lectures des tables d'ODH acceptées, et bornées", () => {
    ok("SELECT count() FROM odh.company_master_current WHERE naf_code = '0170Z'");
    ok("select siren from odh.company_prospection_current p join odh.company_master_current m using siren limit 5;");
    ok("WITH v AS (SELECT siren FROM odh.company_prospection_current) SELECT count() FROM v");
    ok("SELECT extract(YEAR FROM creation_date) a, count() FROM odh.company_master_current WHERE naf_code='7500Z' GROUP BY a");
    ok("SELECT legal_name FROM odh.company_master_current WHERE legal_name = 'A; DROP TABLE x' LIMIT 1");
    expect(verifierRequete("SELECT 1 FROM odh.market_cube_current", 50)).toBe("SELECT * FROM (\nSELECT 1 FROM odh.market_cube_current\n) LIMIT 50");
    expect(verifierRequete("SELECT 1 FROM odh.market_cube_current", 99999)).toMatch(/LIMIT 1000$/);
  });

  test("écritures, réglages, tables système, fonctions de table, commentaires et requêtes multiples refusés", () => {
    ko("INSERT INTO odh.company_master_current VALUES (1)", /SELECT ou WITH/);
    ko("SELECT * FROM system.users", /SYSTEM|non autorisée/);
    ko("SELECT * FROM numbers(10)", /non autorisée/);
    ko("SELECT * FROM url('http://x', CSV, 'a String')", /non autorisée/);
    ko("SELECT 1 FROM odh.company_master_current SETTINGS max_threads=64", /SETTINGS/);
    ko("SELECT 1 FROM odh.company_master_current FORMAT CSV", /FORMAT/);
    ko("SELECT 1 FROM odh.company_master_current; SELECT 2 FROM odh.company_master_current", /une seule/);
    ko("SELECT 1 FROM odh.company_master_current -- x", /commentaires/);
    ko("SELECT 1 FROM odh.company_master_current, other.secret", /other\.secret/);
    ko("SELECT 1", /lit une table/);
    ko("", /vide/);
  });
});

describe("vérification par lot", () => {
  test("SIREN et SIRET collés tels quels, doublons fusionnés, reste rendu", () => {
    expect(normaliserSirens(["552 032 534", "54206547900065", "552032534", "abc", "12"])).toEqual({ sirens: ["552032534", "542065479"], invalides: ["abc", "12"] });
  });

  test("quota par espace et par jour, remis à zéro le lendemain", () => {
    const j1 = new Date("2026-11-16T10:00:00Z");
    expect(reserverVerification("t-quota", 30, QUOTA_VERIFICATION.gratuit, j1)).toBe(20);
    expect(() => reserverVerification("t-quota", 21, QUOTA_VERIFICATION.gratuit, j1)).toThrow(/il en reste 20.*plan payant/);
    expect(reserverVerification("t-quota", 20, QUOTA_VERIFICATION.gratuit, j1)).toBe(0);
    expect(reserverVerification("t-quota", 50, QUOTA_VERIFICATION.gratuit, new Date("2026-11-17T10:00:00Z"))).toBe(0);
  });
});

describe("outils réservés", () => {
  const ctx = { userId: "u", email: "u@x", tenantId: "t", tenantOwnerId: "u", workspaces: [], isAdmin: true, activeWorkspaceId: null };
  const noms = (droits?: object) => outilsVisibles({ ctx, workspaceId: null, ...(droits ? { droits: droits as never } : {}) }).map((o) => o.name);

  test("sans accès avancé : ni SQL ni clés ; vérification pour tous", () => {
    const n = noms({ accesAvance: false, adminAtlas: false, plan: "freemium", payant: false });
    expect(n).toContain("verifier_entreprises");
    expect(n).toContain("mes_droits");
    expect(n).not.toContain("requete_sql");
    expect(n).not.toContain("creer_cle_api");
    expect(n).not.toContain("accorder_acces_avance");
    expect(noms()).not.toContain("requete_sql"); // droits inconnus : caché
  });

  test("accès avancé : SQL et clés ; administration seulement pour un administrateur Atlas", () => {
    const n = noms({ accesAvance: true, adminAtlas: false, plan: "pro", payant: true });
    expect(n).toEqual(expect.arrayContaining(["schema_odh", "requete_sql", "lister_cles_api", "creer_cle_api", "revoquer_cle_api"]));
    expect(n).not.toContain("accorder_acces_avance");
    expect(noms({ accesAvance: false, adminAtlas: true, plan: null, payant: false })).toContain("accorder_acces_avance");
  });
});

describe("clés API", () => {
  beforeEach(() => {
    db.cles.length = 0;
    db.tenants.set("t1", { accesAvance: true, plan: "pro" });
    db.users.set("u1", { id: "u1", email: "client@x.fr", atlasAdmin: false });
    oublierDroits();
  });

  test("créée une fois en clair, gardée hachée, reconnue, puis refusée une fois révoquée", async () => {
    const c = await creerCle({ userId: "u1", tenantId: "t1" }, "script");
    expect(c.cle).toMatch(/^atl_[A-Za-z0-9_-]{43}$/);
    expect(db.cles[0].empreinte).toBe(empreinte(c.cle));
    expect(JSON.stringify(db.cles)).not.toContain(c.cle);
    expect((await contexteDepuisCle(`Bearer ${c.cle}`))?.tenantId).toBe("t1");
    expect(await contexteDepuisCle(`Bearer ${c.cle}x`)).toBeNull();
    expect(await contexteDepuisCle(c.cle)).toBeNull(); // sans « Bearer »
    await revoquerCle("t1", c.id);
    expect(await contexteDepuisCle(`Bearer ${c.cle}`)).toBeNull();
  });

  test("un espace sans accès avancé ne crée pas de clé, et ses anciennes clés cessent de marcher", async () => {
    const c = await creerCle({ userId: "u1", tenantId: "t1" }, "script");
    db.tenants.set("t1", { accesAvance: false, plan: "pro" });
    oublierDroits();
    expect(await contexteDepuisCle(`Bearer ${c.cle}`)).toBeNull();
    await expect(creerCle({ userId: "u1", tenantId: "t1" }, "autre")).rejects.toThrow(/accès avancé/);
  });
});

describe("pile logicielle d'ODH", () => {
  test("filtre par sous-requête, colonne par jointure, répartition sur la vue", async () => {
    const { compilerFiltre, colonnesSql } = await import("@/atlas/filtres");
    const f = compilerFiltre({ conditions: [{ champ: "logiciel", op: "dans", valeur: ["odoo", "brevo"] }, { champ: "type_logiciel", op: "hors", valeur: ["erp"] }] });
    expect(f.where).toContain("siren IN (SELECT siren FROM odh.company_tech_stack_current WHERE hasAny(tools_fort, {p0:Array(String)}))");
    expect(f.where).toContain("siren NOT IN (SELECT siren FROM odh.company_tech_stack_current WHERE hasAny(families_fort, {p1:Array(String)}))");
    expect(compilerFiltre({ conditions: [{ champ: "logiciel", op: "renseigne", valeur: true }] }).where).toContain("WHERE notEmpty(tools_fort))");
    const c = colonnesSql(["nom", "logiciel", "type_logiciel"]);
    expect(c.sql).toContain("arrayStringConcat(j0.__logiciel, ', ') AS logiciel");
    expect(c.jointures).toBe("LEFT JOIN (SELECT siren, tools_fort AS __logiciel, families_fort AS __type_logiciel FROM odh.company_tech_stack_current) AS j0 USING (siren)");
    expect(colonnesSql(["nom"]).jointures).toBe("");
  });

  test("vues ouvertes au SQL avancé, noms commerciaux à l'écran", async () => {
    expect(() => verifierRequete("SELECT naf_code, nb_entreprises FROM odh.market_cube_tech_current WHERE tool = 'odoo'")).not.toThrow();
    expect(() => verifierRequete("SELECT siren FROM odh.company_tech_stack_current WHERE has(tools_fort, 'dolibarr')")).not.toThrow();
    const { libelleValeur } = await import("@/atlas/libelles");
    expect(libelleValeur("logiciel", "hubspot")).toBe("HubSpot");
    expect(libelleValeur("logiciel", "odoo, brevo")).toBe("Odoo, Brevo");
    expect(libelleValeur("logiciel", "nouveau")).toBe("Nouveau");
    expect(libelleValeur("logiciel", "interne:erp")).toBe("Outil interne (ERP (gestion))");
    expect(libelleValeur("type_logiciel", "emailing")).toBe("Emailing");
  });
});

describe("envoyable = adresse valable ET fiche livrable (ODH, 17/11)", () => {
  test("filtre, colonne et base maître exigent les deux", async () => {
    const { compilerFiltre, colonnesSql } = await import("@/atlas/filtres");
    expect(compilerFiltre({ conditions: [{ champ: "email_envoyable", op: "est", valeur: true }] }).where).toContain("(email_envoyable = 1 AND deliverable = 1) = 1");
    expect(compilerFiltre({ conditions: [{ champ: "telephone_envoyable", op: "est", valeur: true }] }).where).toContain("(telephone_envoyable = 1 AND deliverable = 1) = 1");
    expect(colonnesSql(["email_envoyable"]).sql).toContain("(email_envoyable = 1 AND deliverable = 1) AS email_envoyable");
    const { compilerMaitre } = await import("@/atlas/maitre");
    expect(compilerMaitre({ conditions: [{ champ: "email_envoyable", op: "est", valeur: true }] }).where).toContain("(email_envoyable = 1 AND prospectable = 1) = 1");
  });

  test("l'export ne sort jamais une fiche non livrable", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/api/atlas/export/route.ts", "utf8")).toMatch(/livrablesSeuls: true/);
    const { libelleValeur } = await import("@/atlas/libelles");
    expect(libelleValeur("motif_email", "block_honeypot")).toBe("Piège à spam");
  });
});

describe("signaux d'évolution d'ODH (ODH-0272)", () => {
  test("filtre hasAny, colonne jointe, tri par date du dernier signal", async () => {
    const { compilerFiltre, colonnesSql } = await import("@/atlas/filtres");
    expect(compilerFiltre({ conditions: [{ champ: "signal_90j", op: "dans", valeur: ["dirigeant_change"] }] }).where).toContain("hasAny(sig_types_90d, {p0:Array(String)})");
    expect(compilerFiltre({ conditions: [{ champ: "signal_12_mois", op: "hors", valeur: ["radiation"] }] }).where).toContain("NOT hasAny(sig_types_365d,");
    expect(compilerFiltre({ conditions: [{ champ: "signal_90j", op: "renseigne", valeur: true }] }).where).toContain("notEmpty(sig_types_90d)");
    expect(colonnesSql(["signal_90j"]).sql).toContain("arrayStringConcat(sig_types_90d, ', ') AS signal_90j");
  });

  test("événements de la fiche lisibles, entrée abîmée ignorée", async () => {
    const { evenementsLisibles } = await import("@/atlas/source");
    expect(evenementsLisibles('[{"date":"2026-09-14","type":"dirigeant_change","before":"","after":""},{"date":"2026-03-01","type":"naf_change","before":"4778C","after":"4776Z"}]')).toEqual([
      "14/09/2026 · Changement de dirigeant",
      "01/03/2026 · Changement d'activité (NAF) (4778C → 4776Z)",
    ]);
    expect(evenementsLisibles("pas du json")).toBeNull();
    expect(evenementsLisibles("[]")).toBeNull();
    const { libelleValeur } = await import("@/atlas/libelles");
    expect(libelleValeur("signal_90j", "acquisition_fonds, siege_transfert")).toBe("Rachat d'un fonds de commerce, Transfert du siège");
  });
});
