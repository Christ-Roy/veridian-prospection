/**
 * Filtre âge dirigeant — Playwright spec.
 *
 * Couvre la feature ajoutée dans la sidebar "Filtre Qualité":
 *  1. Ouverture de la sidebar Qualité depuis /prospects
 *  2. Présence des chips d'âge dirigeant (5 ranges : <35, 35-44, 45-54, 55-64, 65+)
 *  3. Sélection d'un chip → état pressed actif (aria-pressed=true)
 *  4. Apply → l'appel /api/prospects part avec ?ageDirigeant=35-44
 *  5. Multi-sélection → CSV "0-34,>=65"
 *
 * Le filtre s'appuie sur COLUMN_MAP.age_dirigeant (livré dans 55a3226 mais
 * pas câblé dans l'UI réellement utilisée — c'est ce que ce spec corrige).
 */
import { test, expect, type Request } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";

async function openQualitySidebar(page: import("@playwright/test").Page) {
  // The Quality button is in the top filter bar
  const qualityBtn = page.getByRole("button", { name: /qualit/i }).first();
  await qualityBtn.waitFor({ state: "visible", timeout: 10000 });
  await qualityBtn.click();
  // Wait for the sidebar to be visible
  await page.getByText(/Filtre Qualit/i).first().waitFor({ state: "visible", timeout: 5000 });
}

test.describe("Age dirigeant filter", () => {
  test("chips are rendered in Quality sidebar", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await openQualitySidebar(page);

    // Section header
    await expect(page.getByText(/Âge du dirigeant/i)).toBeVisible();

    // 5 chips (testid sanitizes special chars: ">=65" → "__65")
    for (const tid of ["age-chip-0-34", "age-chip-35-44", "age-chip-45-54", "age-chip-55-64", "age-chip-__65"]) {
      await expect(page.getByTestId(tid)).toBeVisible();
    }
  });

  test("selecting a chip toggles aria-pressed and applies via query param", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await openQualitySidebar(page);

    const chip = page.getByTestId("age-chip-35-44");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    // Capture next /api/prospects request triggered by Apply
    const reqPromise = page.waitForRequest(
      (req: Request) => req.url().includes("/api/prospects") && req.url().includes("ageDirigeant="),
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /^Appliquer$/ }).click();
    const req = await reqPromise;
    const url = new URL(req.url());
    expect(url.searchParams.get("ageDirigeant")).toBe("35-44");
  });

  test("multi-selection produces CSV in query string", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await openQualitySidebar(page);

    await page.getByTestId("age-chip-0-34").click();
    await page.getByTestId("age-chip-__65").click();

    const reqPromise = page.waitForRequest(
      (req: Request) => req.url().includes("/api/prospects") && req.url().includes("ageDirigeant="),
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /^Appliquer$/ }).click();
    const req = await reqPromise;
    const url = new URL(req.url());
    const param = url.searchParams.get("ageDirigeant") || "";
    const parts = param.split(",").sort();
    expect(parts).toContain("0-34");
    expect(parts.some((p) => p.includes("65"))).toBe(true);
  });
});
