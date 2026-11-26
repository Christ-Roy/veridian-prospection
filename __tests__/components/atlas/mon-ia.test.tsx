/**
 * CONTRAT-HUB §5.24.1, épreuve côté app : sans moteur, la carte « Relier mon IA » et JAMAIS le cadre ; avec moteur, le
 * cadre du Hub pour cette organisation ; sinon rien. Forcer le cadre sans moteur doit faire échouer ce fichier.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { FenetreMonIA } from "@/components/atlas/mon-ia";

const HUB = "https://app.veridian.site";
const rendre = (affichage: "cadre" | "carte" | null, org: string | null = "8b9f0c1e-0000-4000-8000-000000000001") =>
  renderToStaticMarkup(createElement(FenetreMonIA, { affichage, hub: HUB, organisationHub: org, onFermer: () => {} }));

describe("fenêtre Mon IA", () => {
  test("sans moteur : la carte, aucun cadre, aucun champ, un lien vers le Hub en nouvel onglet", () => {
    const html = rendre("carte");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/<input|<textarea/);
    expect(html).toContain("Relier mon IA");
    expect(html).toContain("Votre IA travaille dans vos apps Veridian depuis son propre écran (Claude, ChatGPT, Mistral…) : reliez-la une fois, sans clé.");
    expect(html).toContain(`href="${HUB}/dashboard/ia"`);
    expect(html).toContain('target="_blank"');
  });
  test("avec moteur : le cadre du Hub pour l'organisation, sans la carte", () => {
    const html = rendre("cadre");
    expect(html).toContain(`<iframe title="Mon IA" src="${HUB}/ia/chat?app=prospection&amp;tenant=8b9f0c1e-0000-4000-8000-000000000001"`);
    expect(html).not.toContain("mon-ia-carte");
  });
  test("éteinte, Hub muet ou espace non relié : rien", () => {
    expect(rendre(null)).toBe("");
    expect(rendre("cadre", null)).toBe("");
  });
});
