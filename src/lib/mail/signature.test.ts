/**
 * Tests colocalisés pour applySignatureIfEnabled (W9c §J — signature
 * commerciale auto). Extraits de l'ancien outbox.test.ts lors du revert
 * post-W9c (suppression de la queue mail_outbox 2026-05-26).
 *
 * Couvre :
 *  - no-op si config absente / disabled / signature vide
 *  - append HTML wrapper div .veridian-mail-signature
 *  - append plain text avec séparateur --
 *  - pas de mutation du payload input (immutable)
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  applySignatureIfEnabled,
  stripHtml,
  type MailBody,
} from "./signature";

describe("applySignatureIfEnabled", () => {
  const baseBody: MailBody = {
    bodyText: "Bonjour Robert",
    bodyHtml: "<p>Bonjour Robert</p>",
  };

  function makeClient(
    signature: { html: string | null; enabled: boolean } | null,
  ): PrismaClient {
    return {
      tenantMailConfig: {
        findUnique: vi.fn().mockResolvedValue(
          signature
            ? {
                mailSignatureHtml: signature.html,
                mailSignatureEnabled: signature.enabled,
              }
            : null,
        ),
      },
    } as unknown as PrismaClient;
  }

  it("no-op if config row missing", async () => {
    const out = await applySignatureIfEnabled(makeClient(null), "t", baseBody);
    expect(out).toEqual(baseBody);
  });

  it("no-op if signature_enabled is false", async () => {
    const out = await applySignatureIfEnabled(
      makeClient({ html: "<p>Robert</p>", enabled: false }),
      "t",
      baseBody,
    );
    expect(out).toEqual(baseBody);
  });

  it("no-op if signature_html is null or empty", async () => {
    const a = await applySignatureIfEnabled(
      makeClient({ html: null, enabled: true }),
      "t",
      baseBody,
    );
    expect(a).toEqual(baseBody);

    const b = await applySignatureIfEnabled(
      makeClient({ html: "   ", enabled: true }),
      "t",
      baseBody,
    );
    expect(b).toEqual(baseBody);
  });

  it("appends signature HTML wrapped in marker div", async () => {
    const out = await applySignatureIfEnabled(
      makeClient({ html: "<p>--<br>Robert Brunon</p>", enabled: true }),
      "t",
      baseBody,
    );
    expect(out.bodyHtml).toContain('class="veridian-mail-signature"');
    expect(out.bodyHtml).toContain("<p>--<br>Robert Brunon</p>");
    expect(out.bodyHtml.startsWith("<p>Bonjour Robert</p>")).toBe(true);
  });

  it("appends signature text (HTML stripped) with -- separator", async () => {
    const out = await applySignatureIfEnabled(
      makeClient({ html: "<p>Robert Brunon</p><p>+33 6 12</p>", enabled: true }),
      "t",
      baseBody,
    );
    expect(out.bodyText).toContain("\n\n--\n");
    expect(out.bodyText).toContain("Robert Brunon");
    expect(out.bodyText).toContain("+33 6 12");
    expect(out.bodyText).not.toContain("<p>");
  });

  it("does not mutate the input body", async () => {
    const snapshot = { ...baseBody };
    await applySignatureIfEnabled(
      makeClient({ html: "<p>sig</p>", enabled: true }),
      "t",
      baseBody,
    );
    expect(baseBody).toEqual(snapshot);
  });
});

describe("stripHtml", () => {
  it("strips simple tags", () => {
    expect(stripHtml("<p>hello</p>")).toBe("hello");
  });

  it("converts <br> to newline", () => {
    expect(stripHtml("a<br>b")).toBe("a\nb");
    expect(stripHtml("a<br/>b")).toBe("a\nb");
    expect(stripHtml("a<br />b")).toBe("a\nb");
  });

  it("collapses runs of >2 newlines", () => {
    expect(stripHtml("a<br><br><br><br>b")).toBe("a\n\nb");
  });
});
