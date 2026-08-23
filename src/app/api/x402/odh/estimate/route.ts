import { createX402RouteHandler } from "@/lib/x402/gateway";
import { handleX402Estimate } from "@/lib/x402/search";

export const dynamic = "force-dynamic";

export const POST = createX402RouteHandler("estimate", handleX402Estimate);
