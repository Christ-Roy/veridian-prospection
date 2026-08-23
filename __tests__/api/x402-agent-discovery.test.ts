import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { X402_ROUTE_PATHS } from "@/lib/x402/gateway";

describe("x402 agent discovery contract", () => {
  it("garde le manifeste et le skill alignes sur les seules routes payantes live", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/.well-known/x402"), "utf8"),
    ) as { resources: { path: string }[] };
    const publicSkill = readFileSync(
      resolve(process.cwd(), "public/.well-known/agent-skills/odh-market-intelligence/SKILL.md"),
      "utf8",
    );

    const paths = manifest.resources.map((resource) => resource.path).sort();
    expect(paths).toEqual(Object.values(X402_ROUTE_PATHS).sort());
    for (const path of paths) expect(publicSkill).toContain(path);
    expect(publicSkill).not.toContain("market-map/jobs");
    expect(publicSkill).toContain("/api/x402/odh/catalog");
  });
});
