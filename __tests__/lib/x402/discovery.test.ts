import { afterEach, describe, expect, it } from "vitest";
import {
  buildX402LlmsTxt,
  buildX402Manifest,
  buildX402SkillMarkdown,
  buildX402SkillsIndex,
  getRequiredX402PublicBaseUrl,
  getX402PublicBaseUrl,
  redirectDisabledX402ToCanonical,
  toX402PublicUrl,
} from "@/lib/x402/discovery";
import { X402_CATALOG_PATH, X402_ROUTE_PATHS, X402_SKILL_PATH } from "@/lib/x402/contract";

const CANONICAL = "https://search-dev.staging.veridian.site";
const originalEnv = { ...process.env };

describe("x402 discovery helpers", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("préfère X402_PUBLIC_BASE_URL même si la façade x402 est désactivée", () => {
    process.env.X402_ENABLED = "0";
    process.env.APP_URL = "https://prospection.staging.veridian.site";
    process.env.X402_PUBLIC_BASE_URL = `${CANONICAL}/ignored/path?x=1`;

    expect(getX402PublicBaseUrl("https://prospection.staging.veridian.site/.well-known/x402")).toBe(CANONICAL);
  });

  it("utilise APP_URL comme fallback seulement quand x402 est activé", () => {
    process.env.X402_ENABLED = "1";
    delete process.env.X402_PUBLIC_BASE_URL;
    process.env.APP_URL = `${CANONICAL}/ignored`;

    expect(getX402PublicBaseUrl("https://internal.local/.well-known/x402")).toBe(CANONICAL);
  });

  it("reste fermé sans base publique quand x402 est désactivé", () => {
    process.env.X402_ENABLED = "0";
    delete process.env.X402_PUBLIC_BASE_URL;
    process.env.APP_URL = "https://prospection.staging.veridian.site";

    expect(getX402PublicBaseUrl("https://prospection.staging.veridian.site/.well-known/x402")).toBeNull();
  });

  it("getRequiredX402PublicBaseUrl échoue explicitement sans base publique", () => {
    process.env.X402_ENABLED = "0";
    delete process.env.X402_PUBLIC_BASE_URL;

    expect(() => getRequiredX402PublicBaseUrl("https://prospection.staging.veridian.site/.well-known/x402")).toThrow(
      "X402_PUBLIC_BASE_URL",
    );
  });

  it("toX402PublicUrl construit une URL absolue canonique", () => {
    expect(toX402PublicUrl(X402_CATALOG_PATH, CANONICAL)).toBe(`${CANONICAL}${X402_CATALOG_PATH}`);
  });

  it("buildX402Manifest annonce catalogue, skill et ressources en URLs absolues", () => {
    process.env.X402_NETWORK = "eip155:84532";

    const manifest = buildX402Manifest(CANONICAL);

    expect(manifest.discovery.catalog).toBe(`${CANONICAL}${X402_CATALOG_PATH}`);
    expect(manifest.discovery.skill).toBe(`${CANONICAL}${X402_SKILL_PATH}`);
    expect(manifest.resources.map((resource) => resource.path)).toEqual([
      `${CANONICAL}${X402_ROUTE_PATHS.estimate}`,
      `${CANONICAL}${X402_ROUTE_PATHS.companies}`,
    ]);
    expect(JSON.stringify(manifest)).not.toContain("https://prospection.staging.veridian.site/api/x402");
  });

  it("buildX402SkillsIndex publie le skill en URL absolue", () => {
    const skillsIndex = buildX402SkillsIndex(CANONICAL);

    expect(skillsIndex.skills[0].url).toBe(`${CANONICAL}${X402_SKILL_PATH}`);
  });

  it("buildX402SkillMarkdown documente le workflow sur l'origine canonique", () => {
    const skill = buildX402SkillMarkdown(CANONICAL);

    expect(skill).toContain(`GET ${CANONICAL}${X402_CATALOG_PATH}`);
    expect(skill).toContain(`POST ${CANONICAL}${X402_ROUTE_PATHS.estimate}`);
    expect(skill).not.toContain("Use the same origin");
  });

  it("buildX402LlmsTxt oriente les crawlers vers l'origine canonique", () => {
    const llms = buildX402LlmsTxt(CANONICAL);

    expect(llms).toContain(`Canonical x402 origin: ${CANONICAL}`);
    expect(llms).toContain(`POST ${CANONICAL}${X402_ROUTE_PATHS.companies}`);
  });

  it("redirige les routes x402 d'une façade non-canonique vers le host public", () => {
    process.env.X402_PUBLIC_BASE_URL = CANONICAL;
    const request = new Request(`https://prospection.staging.veridian.site${X402_ROUTE_PATHS.estimate}?source=agent`);

    const response = redirectDisabledX402ToCanonical(request as never, X402_ROUTE_PATHS.estimate);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(`${CANONICAL}${X402_ROUTE_PATHS.estimate}?source=agent`);
  });
});
