/**
 * Test source-level de /settings/mail/page.tsx.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("/settings/mail/page.tsx", () => {
  test("rend MailConfigForm depuis @/components/mail/mail-config-form", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/app/settings/mail/page.tsx"),
      "utf-8",
    );
    expect(source).toMatch(
      /import\s*\{\s*MailConfigForm\s*\}\s*from\s*["']@\/components\/mail\/mail-config-form["']/,
    );
    expect(source).toContain("<MailConfigForm");
  });

  test("force-dynamic (la config est par-user, jamais cachée)", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/app/settings/mail/page.tsx"),
      "utf-8",
    );
    expect(source).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });
});
