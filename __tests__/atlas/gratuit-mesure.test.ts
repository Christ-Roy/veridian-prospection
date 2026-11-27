/**
 * VER-249, la mesure : ce qu'un compte gratuit demande et voit en coordonnées s'écrit en nombres (jamais l'adresse),
 * réglage éteint ou allumé ; un plan payant est compté sans borne.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ORIENTATION_GRATUIT, orientationGratuit, selonPlan } from "@/atlas/gratuit";
import { compterCoordonnees } from "@/lib/mcp/coordonnees";
import type { ContexteOutil, Outil } from "@/lib/mcp/outils";

const JOUR = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
const LIGNES = { total: 3, lignes: [{ nom: "A", email: "a@a.fr", telephone: "04 78 00 00 00" }, { nom: "B", email: "", telephone: null }, { nom: "C", telephone: "0478000001" }] };
const outil = { name: "explorer_marche", annotations: { readOnlyHint: true }, run: async () => structuredClone(LIGNES) } as unknown as Outil;
const ctx = (plan: string | null, payant: boolean) =>
  ({ ctx: { userId: "u", tenantId: "t-1", workspaces: [] }, workspaceId: null, droits: { accesAvance: false, adminAtlas: false, plan, payant } }) as unknown as ContexteOutil;

describe("compterCoordonnees", () => {
  test("compte les objets qui portent une coordonnée renseignée, pas les drapeaux ni les retraits", () => {
    expect(compterCoordonnees(LIGNES)).toBe(2);
    expect(compterCoordonnees({ fiche: { emails: ["x@y.fr"], a_email: true }, email: 3 })).toBe(1);
    expect(compterCoordonnees({ lignes: [{ email: "[coordonnée retirée]" }, { email: true }], filtre: { email: "x@y.fr" } })).toBe(0);
  });
});

describe("trace [atlas][coordonnees]", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const traces = () => vi.spyOn(console, "info").mockImplementation(() => {});

  test("gratuit, réglage éteint : tout est montré et compté", async () => {
    vi.stubEnv("ATLAS_GRATUIT_COORDONNEES", "");
    const t = traces();
    expect(JSON.stringify(await selonPlan(outil, {}, ctx("freemium", false)))).toContain("a@a.fr");
    expect(t).toHaveBeenCalledWith(`[atlas][coordonnees] jour=${JOUR} outil=explorer_marche tenant=t-1 plan=freemium reglage=aucun demandees=2 montrees=2`);
    expect(String(t.mock.calls[0][0])).not.toMatch(/@|04 78/);
  });

  test("gratuit, masque : rien de montré, la demande reste comptée", async () => {
    vi.stubEnv("ATLAS_GRATUIT_COORDONNEES", "masque");
    const t = traces();
    expect(JSON.stringify(await selonPlan(outil, {}, ctx(null, false)))).not.toContain("a@a.fr");
    expect(t).toHaveBeenCalledWith(`[atlas][coordonnees] jour=${JOUR} outil=explorer_marche tenant=t-1 plan=aucun reglage=masque demandees=2 montrees=0`);
  });

  test("payant : jamais borné, compté (réglage=payant) pour relever son usage réel", async () => {
    vi.stubEnv("ATLAS_GRATUIT_COORDONNEES", "masque");
    const t = traces();
    expect(JSON.stringify(await selonPlan(outil, {}, ctx("pro", true)))).toContain("a@a.fr");
    expect(t).toHaveBeenCalledWith(`[atlas][coordonnees] jour=${JOUR} outil=explorer_marche tenant=t-1 plan=pro reglage=payant demandees=2 montrees=2`);
  });

  test("accès avancé : rien d'écrit", async () => {
    const t = traces();
    await selonPlan(outil, {}, { ...ctx("pro", true), droits: { accesAvance: true, adminAtlas: false, plan: "pro", payant: true } } as unknown as ContexteOutil);
    expect(t).not.toHaveBeenCalled();
  });
});

describe("orientationGratuit", () => {
  test("fiches:20 : la phrase dit les 20 fiches, pas « réservés » tout court ; masque : réservés", () => {
    expect(orientationGratuit({ fiches: 20 })).toMatch(/fiche d'une entreprise, 20 fiches par jour.*listes et l'export sont réservés/);
    expect(orientationGratuit({ fiches: 0 })).toBe(ORIENTATION_GRATUIT);
    expect(orientationGratuit(null)).toBe(ORIENTATION_GRATUIT);
  });

  test("une liste d'un gratuit en fiches:20 porte la phrase juste", async () => {
    vi.stubEnv("ATLAS_GRATUIT_COORDONNEES", "fiches:20");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const v = (await selonPlan(outil, {}, ctx("freemium", false))) as { coordonnees_retirees?: string };
    expect(v.coordonnees_retirees).toMatch(/20 fiches par jour/);
    vi.unstubAllEnvs();
  });
});
