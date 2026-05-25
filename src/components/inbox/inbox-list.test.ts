/**
 * Tests source-level pour les composants Inbox.
 *
 * Pas de @testing-library dans le repo : on lit le fichier source et on
 * vérifie que les contrats critiques sont présents (data-testid pour E2E,
 * fallback "non rattaché", lien /leads/:siren, modal d'attachement, etc).
 *
 * Run: npx vitest run src/components/inbox/inbox-list.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("InboxList — contrats UI", () => {
  const src = read("src/components/inbox/InboxList.tsx");

  it("affiche un état vide si items.length === 0", () => {
    expect(src).toContain("Aucun mail dans la boîte");
    expect(src).toContain('data-testid="inbox-empty"');
  });

  it("expose data-testid par row pour E2E (inbox-row-<id>)", () => {
    expect(src).toContain("inbox-row-${item.id}");
  });

  it("badge 'Non rattaché' visible pour les mails orphans (siren null)", () => {
    expect(src).toContain("Non rattaché");
    expect(src).toContain("inbox-orphan-");
  });

  it("lien vers /leads/:siren quand le mail est rattaché", () => {
    expect(src).toContain("/leads/${item.siren}");
    expect(src).toContain("inbox-attached-");
  });

  it("bouton 'Rattacher' uniquement pour les orphans + ouvre la modale", () => {
    expect(src).toContain("Rattacher");
    expect(src).toContain("inbox-attach-btn-");
    expect(src).toContain("AttachProspectModal");
  });

  it("affiche icône direction (incoming → ArrowDownLeft, outgoing → ArrowUpRight)", () => {
    expect(src).toContain("ArrowDownLeft");
    expect(src).toContain("ArrowUpRight");
  });

  it("truncate subject à 80 chars (UI safety)", () => {
    expect(src).toContain("SUBJECT_TRUNCATE = 80");
  });

  it("truncate preview à 120 chars", () => {
    expect(src).toContain("PREVIEW_TRUNCATE = 120");
  });

  it("fallback '(sans contenu)' si body preview vide", () => {
    expect(src).toContain("(sans contenu)");
  });

  it("fallback '(sans sujet)' si subject null/vide", () => {
    expect(src).toContain("(sans sujet)");
  });

  it("bouton 'Charger plus' visible si nextCursor non-null", () => {
    expect(src).toContain("inbox-load-more");
    expect(src).toContain("Charger plus");
  });

  it("loadMore préserve les search params existants (filters)", () => {
    expect(src).toContain('searchParams?.toString()');
    expect(src).toContain('qp.set("cursor", nextCursor)');
  });
});

describe("InboxFilters — contrats UI", () => {
  const src = read("src/components/inbox/InboxFilters.tsx");

  it("expose 3 boutons direction (all / in / out)", () => {
    expect(src).toContain("inbox-filter-direction-all");
    expect(src).toContain("inbox-filter-direction-in");
    expect(src).toContain("inbox-filter-direction-out");
  });

  it("expose 3 boutons status (all / attached / orphan)", () => {
    expect(src).toContain("inbox-filter-status-all");
    expect(src).toContain("inbox-filter-status-attached");
    expect(src).toContain("inbox-filter-status-orphan");
  });

  it("reset cursor en changeant un filtre (évite cursor invalide)", () => {
    expect(src).toContain('qp.delete("cursor")');
  });

  it("ne push pas direction=all en URL (clean URL)", () => {
    expect(src).toContain('if (updates.direction === "all") qp.delete("direction")');
  });
});

describe("AttachProspectModal — contrats UI", () => {
  const src = read("src/components/inbox/AttachProspectModal.tsx");

  it("recherche live via /api/leads?f_search=", () => {
    expect(src).toContain("/api/leads?");
    expect(src).toContain("f_search");
  });

  it("POST /api/inbox/attach avec leadEmailId + siren", () => {
    expect(src).toContain("/api/inbox/attach");
    expect(src).toContain("leadEmailId");
    expect(src).toContain("siren");
  });

  it("Content-Type application/json sur le POST", () => {
    expect(src).toMatch(/Content-Type["']?\s*:\s*["']application\/json/);
  });

  it("filtre les candidats sur regex SIREN (9 chiffres)", () => {
    expect(src).toContain("/^\\d{9}$/");
  });

  it("toast success après attach + router.refresh()", () => {
    expect(src).toContain("toast.success");
    expect(src).toContain("router.refresh()");
  });

  it("toast error sur échec HTTP non-ok", () => {
    expect(src).toContain("toast.error");
  });

  it("min 2 chars pour déclencher la recherche (UX cohérent)", () => {
    expect(src).toContain("query.trim().length");
  });

  it("debounce de la recherche (clearTimeout dans cleanup)", () => {
    expect(src).toContain("clearTimeout");
  });
});

describe("Page /inbox — server component", () => {
  const src = read("src/app/inbox/page.tsx");

  it("force dynamic (pas de cache statique)", () => {
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("appelle requireUser() (page protégée)", () => {
    expect(src).toContain("requireUser()");
  });

  it("redirige vers /login si non authentifié", () => {
    expect(src).toContain('redirect("/login")');
  });

  it("passe tenantId + workspaceFilter à listInboxEmails", () => {
    expect(src).toContain("auth.ctx.tenantId");
    expect(src).toContain("getWorkspaceFilter(auth.ctx)");
  });

  it("wrapper TrialGate (consistance avec /historique, /pipeline)", () => {
    expect(src).toContain("TrialGate");
  });

  it("convertit occurredAt en ISO string pour le client component", () => {
    expect(src).toContain("toISOString()");
  });
});

describe("AppNav — entrée Inbox", () => {
  const src = read("src/components/layout/app-nav.tsx");

  it("entrée /inbox présente dans navItems", () => {
    expect(src).toContain('href: "/inbox"');
    expect(src).toContain('label: "Inbox"');
  });

  it("icône Inbox importée depuis lucide-react", () => {
    expect(src).toMatch(/import\s*{[^}]*Inbox[^}]*}\s*from\s*["']lucide-react["']/);
  });
});
