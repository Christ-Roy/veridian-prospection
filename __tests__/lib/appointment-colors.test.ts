/**
 * Tests unit `lib/appointment-colors` — palette partagée des rendez-vous.
 *
 * `appointment-colors` est la source de vérité unique pour la couleur
 * d'un RDV selon son `sourceStage` pipeline. Consommée par :
 *   - `components/dashboard/appointment-calendar.tsx` (vue FullCalendar)
 *   - `components/dashboard/upcoming-appointments.tsx` (liste latérale)
 *
 * Si la palette diverge entre les deux vues, on perd la cohérence visuelle
 * qui permet à l'utilisateur d'associer instantanément couleur ↔ stage.
 *
 * Cas testés :
 *  - mapping exhaustif des 3 stages connus (a_rappeler, site_demo, default)
 *  - `resolveStageKey` accepte `null` / `undefined` / string inconnue
 *    sans crasher → retombe sur `"default"`
 *  - chaque palette expose les 5 propriétés attendues (fcVar, fcBorderVar,
 *    surface, icon, dot) et aucune n'est vide ou nullish
 *  - les 3 palettes ont des couleurs **distinctes** (aucune collision de
 *    `dot` ou de `fcVar`) — si quelqu'un copy/paste une palette, on
 *    rattrape ici, pas en prod
 *  - les variables CSS suivent le contrat `var(--fc-appt-*)` attendu par
 *    `globals.css` (theming OKLCH centralisé)
 */
import { describe, it, expect } from "vitest";
import {
  appointmentPalette,
  resolveStageKey,
  type AppointmentStageKey,
} from "@/lib/appointment-colors";

describe("resolveStageKey — normalisation du sourceStage", () => {
  it("conserve `a_rappeler` tel quel", () => {
    expect(resolveStageKey("a_rappeler")).toBe("a_rappeler");
  });

  it("conserve `site_demo` tel quel", () => {
    expect(resolveStageKey("site_demo")).toBe("site_demo");
  });

  it("retombe sur `default` pour `null`", () => {
    expect(resolveStageKey(null)).toBe("default");
  });

  it("retombe sur `default` pour `undefined`", () => {
    expect(resolveStageKey(undefined)).toBe("default");
  });

  it("retombe sur `default` pour une string vide", () => {
    expect(resolveStageKey("")).toBe("default");
  });

  it("retombe sur `default` pour un stage inconnu (legacy / typo)", () => {
    // Sécurise contre les stages legacy retrouvés en DB (ex: `qualified`,
    // `contacte`) qui ne sont pas porteurs d'échéance — on les affiche
    // avec la couleur neutre plutôt que de crasher.
    expect(resolveStageKey("qualified")).toBe("default");
    expect(resolveStageKey("xyz_unknown")).toBe("default");
    expect(resolveStageKey("fiche_ouverte")).toBe("default");
  });
});

describe("appointmentPalette — structure de chaque palette", () => {
  const stages: AppointmentStageKey[] = ["a_rappeler", "site_demo", "default"];

  for (const stage of stages) {
    it(`expose les 5 propriétés pour stage="${stage}"`, () => {
      const p = appointmentPalette(stage);
      expect(p).toBeDefined();
      expect(p.fcVar).toBeTruthy();
      expect(p.fcBorderVar).toBeTruthy();
      expect(p.surface).toBeTruthy();
      expect(p.icon).toBeTruthy();
      expect(p.dot).toBeTruthy();
    });

    it(`fcVar et fcBorderVar pour "${stage}" suivent le contrat var(--fc-appt-*)`, () => {
      // Le theming OKLCH des RDV est centralisé dans globals.css via les
      // variables --fc-appt-*-bg / --fc-appt-*-border. Si on change le
      // préfixe ici sans synchroniser, FullCalendar perd ses couleurs.
      const p = appointmentPalette(stage);
      expect(p.fcVar).toMatch(/^var\(--fc-appt-[a-z]+-bg\)$/);
      expect(p.fcBorderVar).toMatch(/^var\(--fc-appt-[a-z]+-border\)$/);
    });
  }
});

describe("appointmentPalette — fallback comme resolveStageKey", () => {
  it("retombe sur la palette `default` pour null", () => {
    const nullPalette = appointmentPalette(null);
    const defaultPalette = appointmentPalette("default");
    expect(nullPalette).toEqual(defaultPalette);
  });

  it("retombe sur la palette `default` pour un stage inconnu", () => {
    expect(appointmentPalette("zzz")).toEqual(appointmentPalette("default"));
  });
});

describe("appointmentPalette — couleurs distinctes entre stages", () => {
  // Garde-fou anti-copy/paste : si quelqu'un duplique une palette par
  // erreur, on perd la lisibilité visuelle. On vérifie que chaque
  // dimension chromatique est unique entre les 3 palettes.
  const rappel = appointmentPalette("a_rappeler");
  const demo = appointmentPalette("site_demo");
  const def = appointmentPalette("default");

  it("`fcVar` distinct entre les 3 stages", () => {
    const all = [rappel.fcVar, demo.fcVar, def.fcVar];
    expect(new Set(all).size).toBe(3);
  });

  it("`fcBorderVar` distinct entre les 3 stages", () => {
    const all = [rappel.fcBorderVar, demo.fcBorderVar, def.fcBorderVar];
    expect(new Set(all).size).toBe(3);
  });

  it("`dot` (pastille) distinct entre les 3 stages", () => {
    const all = [rappel.dot, demo.dot, def.dot];
    expect(new Set(all).size).toBe(3);
  });

  it("`icon` distinct entre les 3 stages", () => {
    const all = [rappel.icon, demo.icon, def.icon];
    expect(new Set(all).size).toBe(3);
  });

  it("`surface` distinct entre les 3 stages", () => {
    const all = [rappel.surface, demo.surface, def.surface];
    expect(new Set(all).size).toBe(3);
  });
});

describe("appointmentPalette — cohérence de la dimension chromatique", () => {
  // Chaque palette utilise une teinte unique : amber pour a_rappeler,
  // violet pour site_demo, sky pour default. Si quelqu'un mélange (ex :
  // amber sur le dot et sky sur l'icon), on perd la lisibilité.
  it("a_rappeler utilise la teinte amber sur toutes ses surfaces visibles", () => {
    const p = appointmentPalette("a_rappeler");
    expect(p.surface).toContain("amber");
    expect(p.icon).toContain("amber");
    expect(p.dot).toContain("amber");
  });

  it("site_demo utilise la teinte violet sur toutes ses surfaces visibles", () => {
    const p = appointmentPalette("site_demo");
    expect(p.surface).toContain("violet");
    expect(p.icon).toContain("violet");
    expect(p.dot).toContain("violet");
  });

  it("default utilise la teinte sky sur toutes ses surfaces visibles", () => {
    const p = appointmentPalette("default");
    expect(p.surface).toContain("sky");
    expect(p.icon).toContain("sky");
    expect(p.dot).toContain("sky");
  });
});

describe("appointmentPalette — support dark mode obligatoire", () => {
  // Veridian = dark mode first-class. Chaque palette DOIT exposer une
  // variante dark: pour la `surface` (sinon RDV invisibles en mode sombre).
  const stages: AppointmentStageKey[] = ["a_rappeler", "site_demo", "default"];

  for (const stage of stages) {
    it(`palette "${stage}" expose une variante dark: dans surface`, () => {
      const p = appointmentPalette(stage);
      expect(p.surface).toMatch(/dark:/);
    });

    it(`palette "${stage}" expose une variante dark: dans icon`, () => {
      const p = appointmentPalette(stage);
      expect(p.icon).toMatch(/dark:/);
    });
  }
});

export {};
