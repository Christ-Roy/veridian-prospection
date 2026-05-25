/**
 * Tests Nuclear pour src/lib/mail/tenant-templates.ts.
 *
 * Couvre :
 *  - listTenantTemplates : merge customs + fallbacks, customs shadow fallbacks
 *  - resolveTemplate : custom prioritaire, fallback si pas trouvé
 *  - createTenantTemplate : conflict slug → TenantTemplateConflictError
 *
 * Prisma est mocké via vi.mock — pas de DB réelle. Le but : valider la
 * LOGIQUE de merge / shadow / conflict, pas l'intégrité du SQL (couvert
 * en E2E).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/prisma AVANT l'import du module testé.
const findManyMock = vi.fn();
const findFirstMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantMailTemplate: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import {
  listTenantTemplates,
  resolveTemplate,
  createTenantTemplate,
  TenantTemplateConflictError,
} from "./tenant-templates";

describe("listTenantTemplates", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("returns only fallbacks when no customs", async () => {
    findManyMock.mockResolvedValue([]);
    const out = await listTenantTemplates("t1");
    // Au moins les 2 fallbacks Veridian (relance + démo).
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.some((t) => t.slug === "relance-commerciale-v1")).toBe(true);
    expect(out.some((t) => t.slug === "demo-prospection-v1")).toBe(true);
    // Tous flagués isCustom=false.
    expect(out.every((t) => t.isCustom === false)).toBe(true);
  });

  it("customs shadow fallbacks with same slug", async () => {
    findManyMock.mockResolvedValue([
      { slug: "relance-commerciale-v1", label: "Ma relance v2" },
    ]);
    const out = await listTenantTemplates("t1");
    const relance = out.filter((t) => t.slug === "relance-commerciale-v1");
    expect(relance).toHaveLength(1);
    expect(relance[0].label).toBe("Ma relance v2");
    expect(relance[0].isCustom).toBe(true);
  });

  it("custom-only slugs appear separately and customs come first", async () => {
    findManyMock.mockResolvedValue([
      { slug: "ma-nouvelle", label: "Ma nouvelle" },
    ]);
    const out = await listTenantTemplates("t1");
    expect(out[0].slug).toBe("ma-nouvelle");
    expect(out[0].isCustom).toBe(true);
    // Les fallbacks restent.
    expect(out.some((t) => t.slug === "relance-commerciale-v1")).toBe(true);
  });
});

describe("resolveTemplate", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
  });

  it("returns custom if exists", async () => {
    findFirstMock.mockResolvedValue({
      slug: "relance-commerciale-v1",
      label: "Custom",
      subject: "Custom subject",
      bodyText: "Custom body",
      bodyHtml: "<p>Custom body</p>",
    });
    const tpl = await resolveTemplate("t1", "relance-commerciale-v1");
    expect(tpl?.subject).toBe("Custom subject");
  });

  it("falls back to hardcoded if no custom", async () => {
    findFirstMock.mockResolvedValue(null);
    const tpl = await resolveTemplate("t1", "relance-commerciale-v1");
    expect(tpl).not.toBeNull();
    expect(tpl?.slug).toBe("relance-commerciale-v1");
    // Le fallback a l'intitulé Veridian standard.
    expect(tpl?.label).toContain("Relance");
  });

  it("returns null for unknown slug", async () => {
    findFirstMock.mockResolvedValue(null);
    const tpl = await resolveTemplate("t1", "totally-not-a-template");
    expect(tpl).toBeNull();
  });
});

describe("createTenantTemplate", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    createMock.mockReset();
  });

  it("creates a new template", async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({
      id: "tpl-1",
      slug: "ma-nouvelle",
      label: "Ma nouvelle",
      subject: "S",
      bodyText: "T",
      bodyHtml: "<p>T</p>",
      variables: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const row = await createTenantTemplate("t1", {
      slug: "ma-nouvelle",
      label: "Ma nouvelle",
      subject: "S",
      bodyText: "T",
      bodyHtml: "<p>T</p>",
    });
    expect(row.id).toBe("tpl-1");
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("throws TenantTemplateConflictError if slug already used (not soft-deleted)", async () => {
    findFirstMock.mockResolvedValue({ id: "existing" });
    await expect(
      createTenantTemplate("t1", {
        slug: "ma-nouvelle",
        label: "L",
        subject: "S",
        bodyText: "T",
        bodyHtml: "<p>T</p>",
      }),
    ).rejects.toThrow(TenantTemplateConflictError);
    expect(createMock).not.toHaveBeenCalled();
  });
});
