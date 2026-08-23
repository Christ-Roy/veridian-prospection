import { NextResponse, type NextRequest } from "next/server";
import { FIELD_CATALOG } from "@/lib/search/fields";
import { X402_CATALOG_PATH, X402_ROUTE_PATHS, X402_ROUTE_PRICES, X402_SERVICE_NAME, X402_SKILL_PATH } from "@/lib/x402/contract";
import { getRequiredX402PublicBaseUrl, redirectDisabledX402ToCanonical, toX402PublicUrl } from "@/lib/x402/discovery";
import {
  X402_COMPANY_PUBLIC_FIELDS,
  X402_EXISTS_ONLY_FILTER_FIELDS,
} from "@/lib/x402/public-fields";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.X402_ENABLED !== "1") {
    const redirect = redirectDisabledX402ToCanonical(request, X402_CATALOG_PATH);
    if (redirect) return redirect;
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const baseUrl = getRequiredX402PublicBaseUrl(request.url);

  return NextResponse.json({
    service: X402_SERVICE_NAME,
    protocol: "x402-v2",
    network: process.env.X402_NETWORK,
    canonical_origin: baseUrl,
    recommended_flow: ["catalog", "estimate", "companies"],
    limits: { page_size_max: 50, fields_per_page_max: 20, exact_count_cap: 10_000 },
    endpoints: [
      {
        method: "POST",
        path: toX402PublicUrl(X402_ROUTE_PATHS.estimate, baseUrl),
        url: toX402PublicUrl(X402_ROUTE_PATHS.estimate, baseUrl),
        routePath: X402_ROUTE_PATHS.estimate,
        price: X402_ROUTE_PRICES.estimate,
        purpose: "size a segment and measure contact coverage",
      },
      {
        method: "POST",
        path: toX402PublicUrl(X402_ROUTE_PATHS.companies, baseUrl),
        url: toX402PublicUrl(X402_ROUTE_PATHS.companies, baseUrl),
        routePath: X402_ROUTE_PATHS.companies,
        price: X402_ROUTE_PRICES.companies,
        purpose: "fetch a bounded page of companies and public professional contacts",
      },
    ],
    fields: X402_COMPANY_PUBLIC_FIELDS.map((name) => {
      const definition = FIELD_CATALOG[name];
      return {
        name,
        type: definition.type,
        label: definition.label,
        operators: X402_EXISTS_ONLY_FILTER_FIELDS.has(name) ? ["exists"] : definition.ops,
        ...(definition.enumValues ? { values: definition.enumValues } : {}),
      };
    }),
    skill: toX402PublicUrl(X402_SKILL_PATH, baseUrl),
    payment: {
      discovery: "Call a paid endpoint without PAYMENT-SIGNATURE and decode PAYMENT-REQUIRED from the 402 response.",
      request_header: "PAYMENT-SIGNATURE",
      response_header: "PAYMENT-RESPONSE",
    },
  });
}
