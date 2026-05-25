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

describe("renderTemplate — XSS/injection surface (hardening v1)", () => {
  // CONTEXTE — Décision v1 documentée
  // renderTemplate() est un simple remplacement de chaîne. Il n'échappe
  // PAS le HTML des variables. C'est cohérent avec l'usage v1 :
  //   - prospect.name vient de la DB INPI/dirigeants_uniformised → contrôlé
  //     côté ETL (pas d'input user libre dans ce champ).
  //   - sender.name vient du tenant_mail_config.smtpFromName, saisi par
  //     l'admin de l'app (qui s'envoie à lui-même les conséquences).
  //
  // Ces tests verrouillent ce comportement : si quelqu'un ajoute un
  // template qui injecte un input prospect non-contrôlé (ex: notes libres,
  // contenu LLM), le test "html-vars-injectent-textes" doit servir de
  // signal pour ajouter un escape avant le call site (et non dans
  // renderTemplate qui doit rester pure replace).

  test("les variables sont injectées brutes — pas d'escape implicite", () => {
    const vars = {
      prospect: {
        name: "<script>alert(1)</script>",
        entreprise: "Acme & Co",
      },
      sender: { name: "Bob", email: "bob@v.s" },
    };
    const out = renderTemplate(
      "Bonjour {{ prospect.name }} chez {{ prospect.entreprise }}",
      vars,
    );
    // Comportement v1 : le contenu est inséré tel quel. Un futur escape
    // doit ce passer côté CALLER (route mail/send) avant de templater.
    expect(out).toContain("<script>alert(1)</script>");
    expect(out).toContain("Acme & Co");
  });

  test("HTML rendering: prospect.name contient des balises → présentes brutes", () => {
    const t = MAIL_TEMPLATES["relance-commerciale-v1"]!;
    const evil = {
      prospect: {
        name: "Bobby<script>alert('xss')</script>",
        entreprise: "<img src=x onerror=alert(2)>",
      },
      sender: { name: "Bob", email: "bob@v.s" },
    };
    const html = renderTemplate(t.bodyHtml, evil);
    // Smoke: la donnée est passée — c'est au caller de la sanitizer.
    expect(html).toContain("<script>");
    expect(html).toContain("<img src=x onerror");
    // Mais ZÉRO variable liquid résiduelle.
    expect(html).not.toMatch(/\{\{/);
  });

  test("ne casse pas si une variable string est vide", () => {
    const vars = {
      prospect: { name: "", entreprise: "Acme" },
      sender: { name: "", email: "" },
    };
    expect(renderTemplate("Hi {{ prospect.name }}!", vars)).toBe("Hi !");
  });

  test("préserve les accents (UTF-8) — encodage subject", () => {
    const vars = {
      prospect: { name: "François", entreprise: "Café & Délice" },
      sender: { name: "Hélène", email: "h@v.s" },
    };
    expect(
      renderTemplate("{{ prospect.name }} de {{ prospect.entreprise }}", vars),
    ).toBe("François de Café & Délice");
  });

  test("n'évalue pas une variable de type non-string (Number/Object → laissée brute)", () => {
    // Sécurité défense en profondeur : si un jour `prospect.entreprise`
    // dérive vers un objet (ex: { name, siret }), on ne veut PAS qu'il
    // soit interpolé en `[object Object]` — le code retourne le match.
    // On cast en `unknown` puis `TemplateVars` pour simuler la dérive
    // de type runtime tout en gardant le compilateur content.
    const vars = {
      prospect: {
        name: "Alice",
        entreprise: { foo: "bar" } as unknown as string,
      },
      sender: { name: "Bob", email: "bob@v.s" },
    };
    expect(renderTemplate("{{ prospect.entreprise }}", vars)).toBe(
      "{{ prospect.entreprise }}",
    );
  });
});
