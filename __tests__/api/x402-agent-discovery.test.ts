import { afterEach, describe, expect, it } from "vitest";
import { buildX402LlmsTxt, buildX402Manifest, buildX402SkillMarkdown, buildX402SkillsIndex } from "@/lib/x402/discovery";
import { X402_CATALOG_PATH, X402_ROUTE_PATHS, X402_SKILL_PATH } from "@/lib/x402/contract";

const CANONICAL = "https://search-dev.staging.veridian.site";
const originalEnv = { ...process.env };

describe("x402 agent discovery contract", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("garde le manifeste aligne sur les seules routes payantes live avec URLs absolues canoniques", () => {
    process.env.X402_NETWORK = "eip155:84532";
    const manifest = buildX402Manifest(CANONICAL);

    const paths = manifest.resources.map((resource) => new URL(resource.url).pathname).sort();
    expect(paths).toEqual(Object.values(X402_ROUTE_PATHS).sort());
    for (const resource of manifest.resources) {
      expect(resource.url).toMatch(/^https:\/\/search-dev\.staging\.veridian\.site\/api\/x402\/odh\//);
      expect(resource.path).toBe(resource.url);
      expect(resource.routePath).toMatch(/^\/api\/x402\/odh\//);
    }
    expect(manifest.discovery.catalog).toBe(`${CANONICAL}${X402_CATALOG_PATH}`);
    expect(manifest.discovery.skill).toBe(`${CANONICAL}${X402_SKILL_PATH}`);
    expect(JSON.stringify(manifest)).not.toContain("https://prospection.staging.veridian.site/api/x402");
  });

  it("publie un skill et un llms.txt qui ne demandent jamais le same-origin", () => {
    const publicSkill = buildX402SkillMarkdown(CANONICAL);
    const llms = buildX402LlmsTxt(CANONICAL);
    const skillsIndex = buildX402SkillsIndex(CANONICAL);

    for (const path of Object.values(X402_ROUTE_PATHS)) {
      expect(publicSkill).toContain(`${CANONICAL}${path}`);
      expect(llms).toContain(`${CANONICAL}${path}`);
    }
    expect(publicSkill).not.toContain("Use the same origin");
    expect(publicSkill).not.toContain("market-map/jobs");
    expect(publicSkill).toContain(`${CANONICAL}${X402_CATALOG_PATH}`);
    expect(skillsIndex.skills[0].url).toBe(`${CANONICAL}${X402_SKILL_PATH}`);
  });
});
