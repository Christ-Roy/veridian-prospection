/**
 * Tests du moteur de templates liquid simple.
 */
import { describe, expect, test } from "vitest";
import {
  renderTemplate,
  listTemplates,
  getTemplate,
  MAIL_TEMPLATES,
} from "@/lib/mail/templates";

const baseVars = {
  prospect: { name: "Alice", entreprise: "Acme SAS" },
  sender: { name: "Bob", email: "bob@veridian.site" },
};

describe("renderTemplate", () => {
  test("remplace {{ key.subkey }}", () => {
    expect(renderTemplate("Bonjour {{ prospect.name }} !", baseVars)).toBe(
      "Bonjour Alice !",
    );
  });

  test("tolère le whitespace autour de la clé", () => {
    expect(renderTemplate("{{prospect.name}} - {{  sender.name  }}", baseVars)).toBe(
      "Alice - Bob",
    );
  });

  test("remplace plusieurs occurrences", () => {
    const src = "{{ prospect.name }} chez {{ prospect.entreprise }}, écrit par {{ sender.name }}.";
    expect(renderTemplate(src, baseVars)).toBe(
      "Alice chez Acme SAS, écrit par Bob.",
    );
  });

  test("laisse les variables inconnues brutes (pas de throw)", () => {
    expect(renderTemplate("Hello {{ prospect.unknown }}", baseVars)).toBe(
      "Hello {{ prospect.unknown }}",
    );
  });

  test("ne traverse pas un chemin trop profond", () => {
    expect(renderTemplate("{{ prospect.name.nope }}", baseVars)).toBe(
      "{{ prospect.name.nope }}",
    );
  });
});

describe("listTemplates", () => {
  test("retourne tous les templates avec slug + label", () => {
    const list = listTemplates();
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const t of list) {
      expect(t).toHaveProperty("slug");
      expect(t).toHaveProperty("label");
    }
  });
});

describe("getTemplate", () => {
  test("retourne le template par slug", () => {
    expect(getTemplate("relance-commerciale-v1")).toMatchObject({
      slug: "relance-commerciale-v1",
    });
  });
  test("retourne null pour un slug inconnu", () => {
    expect(getTemplate("inexistant")).toBeNull();
  });
});

describe("MAIL_TEMPLATES — sanity check liquid sur les 2 templates livrés", () => {
  test("relance-commerciale-v1 contient les variables prospect + sender", () => {
    const t = MAIL_TEMPLATES["relance-commerciale-v1"]!;
    expect(t.bodyText).toContain("{{ prospect.name }}");
    expect(t.bodyText).toContain("{{ sender.name }}");
    expect(t.bodyHtml).toContain("{{ prospect.entreprise }}");
  });
  test("demo-prospection-v1 contient les variables prospect + sender", () => {
    const t = MAIL_TEMPLATES["demo-prospection-v1"]!;
    expect(t.subject).toContain("{{ prospect.entreprise }}");
    expect(t.bodyText).toContain("{{ sender.name }}");
  });
  test("le rendu complet d'un template ne laisse aucune variable brute", () => {
    const t = MAIL_TEMPLATES["relance-commerciale-v1"]!;
    const rendered = [
      renderTemplate(t.subject, baseVars),
      renderTemplate(t.bodyText, baseVars),
      renderTemplate(t.bodyHtml, baseVars),
    ].join("\n");
    expect(rendered).not.toMatch(/\{\{/);
  });
});
