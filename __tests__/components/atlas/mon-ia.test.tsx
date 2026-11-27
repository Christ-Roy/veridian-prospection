/**
 * CONTRAT-HUB §5.24.1, épreuve côté app : sans moteur, la carte « Relier mon IA » et JAMAIS le cadre ; avec moteur, le
 * cadre du Hub pour cette organisation ; sinon rien. Forcer le cadre sans moteur doit faire échouer ce fichier.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { LiensIA } from "@/components/atlas/ia";
import { BoutonMonIA, FenetreMonIA } from "@/components/atlas/mon-ia";

const HUB = "https://app.veridian.site";
// Forme servie par le Hub le 27/11 (`GET /api/mcp/liens-installation?app=prospection`, lue à travers liensIA).
const LIENS: LiensIA = {
  url: "https://app.veridian.site/api/mcp",
  claudeCode: "claude mcp add --transport http veridian https://app.veridian.site/api/mcp",
  assistants: [
    { cle: "claude", libelle: "Ajouter à Claude", installation: "https://claude.ai/customize/connectors?modal=add-custom-connector", etape: null },
    { cle: "chatgpt", libelle: "Ouvrir ChatGPT", installation: "https://chatgpt.com/plugins", etape: "Dans ChatGPT sur le web, page Plugins : bouton +, puis « Add custom MCP server »." },
    { cle: "cursor", libelle: "Ajouter à Cursor", installation: "cursor://anysphere.cursor-deeplink/mcp/install?name=veridian", etape: null },
  ],
};
const rendre = (affichage: "cadre" | "carte" | null, org: string | null = "8b9f0c1e-0000-4000-8000-000000000001", liens: LiensIA | null = LIENS) =>
  renderToStaticMarkup(createElement(FenetreMonIA, { affichage, hub: HUB, organisationHub: org, liens, onFermer: () => {} }));
const position = (html: string, morceau: string) => {
  const i = html.indexOf(morceau);
  expect(i, morceau).toBeGreaterThanOrEqual(0);
  return i;
};

describe("fenêtre Mon IA", () => {
  test("sans moteur : la carte, aucun cadre, aucun champ, un lien vers le Hub en nouvel onglet", () => {
    const html = rendre("carte");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/<input|<textarea/);
    expect(html).toContain("Relier mon IA");
    expect(html).toContain("Votre IA travaille dans vos apps Veridian depuis son propre écran (Claude, ChatGPT, Mistral…) : reliez-la une fois, sans clé.");
    expect(html).toContain(`href="${HUB}/dashboard/ia"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('data-carte="relier-mon-ia"');
    expect(html).toMatch(/<a [^>]*>Relier mon IA<\/a>/);
  });
  test("sans moteur : dans la carte et dans cet ordre, les boutons des assistants (étape ChatGPT), l'adresse MCP, la commande Claude Code, le lien Hub", () => {
    const html = rendre("carte");
    const carte = html.slice(position(html, 'data-carte="relier-mon-ia"'));
    const ordre = [
      'href="https://claude.ai/customize/connectors?modal=add-custom-connector"',
      ">Ajouter à Claude</a>",
      ">Ouvrir ChatGPT</a>",
      "« Add custom MCP server »",
      ">Ajouter à Cursor</a>",
      "<code>https://app.veridian.site/api/mcp</code>",
      "<code>claude mcp add --transport http veridian https://app.veridian.site/api/mcp</code>",
      `href="${HUB}/dashboard/ia"`,
    ].map((m) => position(carte, m));
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b));
    // Chaque bouton d'assistant ouvre un nouvel onglet ; aucune étape affichée là où le Hub n'en donne pas.
    expect(carte.match(/<a [^>]*target="_blank"/g)?.length).toBe(4);
    expect(carte.match(/class="hint"/g)?.length).toBe(1);
  });
  test("sans moteur et liens illisibles : le texte et le lien vers le Hub, sans boutons ni adresse", () => {
    const html = rendre("carte", undefined, null);
    expect(html).toContain('data-carte="relier-mon-ia"');
    expect(html).toContain(`href="${HUB}/dashboard/ia"`);
    expect(html).not.toContain("Ajouter à");
    expect(html).not.toContain("<code>");
    expect(html.match(/<a /g)?.length).toBe(1);
  });
  test("avec moteur : le cadre du Hub pour l'organisation, sans la carte", () => {
    const html = rendre("cadre");
    expect(html).toContain(`<iframe title="Mon IA" src="${HUB}/ia/chat?app=prospection&amp;tenant=8b9f0c1e-0000-4000-8000-000000000001"`);
    expect(html).not.toContain("mon-ia-carte");
    expect(html).not.toContain("Ajouter à Claude");
    expect(html).toContain('role="dialog" aria-label="Mon IA"');
  });
  test("éteinte, Hub muet ou espace non relié : rien", () => {
    expect(rendre(null)).toBe("");
    expect(rendre("cadre", null)).toBe("");
  });
});

const bouton = (affichage: "cadre" | "carte" | null) =>
  renderToStaticMarkup(createElement(BoutonMonIA, { affichage, ouvert: false, onBasculer: () => {} }));

describe("bouton de la barre (marques communes §5.24.1, cas 56 du Hub)", () => {
  test("sans moteur : data-mon-ia=sans_moteur et « Relier mon IA »", () => {
    // Le bouton est DANS la marque : le cas 56 du Hub clique `[data-mon-ia] button`.
    expect(bouton("carte")).toMatch(/^<span [^>]*data-mon-ia="sans_moteur"[^>]*><button [^>]*>Relier mon IA<\/button><\/span>$/);
  });
  test("avec moteur : data-mon-ia=prete et « Mon IA »", () => {
    expect(bouton("cadre")).toMatch(/^<span [^>]*data-mon-ia="prete"[^>]*><button [^>]*>Mon IA<\/button><\/span>$/);
  });
  test("éteinte ou Hub muet : aucune marque", () => {
    expect(bouton(null)).toBe("");
  });
});
