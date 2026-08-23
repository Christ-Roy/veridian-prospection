import { NextResponse, type NextRequest } from "next/server";
import {
  FacilitatorResponseError,
  HTTPFacilitatorClient,
  SETTLEMENT_OVERRIDES_HEADER,
  getFacilitatorResponseError,
  withPrivateCacheControl,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type RouteConfig,
  type RoutesConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
  validateBazaarRouteExtensions,
} from "@x402/extensions/bazaar";
import { isRateLimited } from "@/lib/rate-limit";
import { X402_ROUTE_PATHS, X402_ROUTE_PRICES, type X402Endpoint } from "./contract";
import { redirectDisabledX402ToCanonical } from "./discovery";
import { X402_COMPANY_PUBLIC_FIELDS } from "./public-fields";

type Handler = (request: NextRequest) => Promise<NextResponse>;
type PaymentVerifiedResult = Extract<
  Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>,
  { type: "payment-verified" }
>;
type CancelSettlement = Awaited<ReturnType<PaymentVerifiedResult["cancellationDispatcher"]["cancel"]>>;

const BASE_SEPOLIA = "eip155:84532";
const BASE_MAINNET = "eip155:8453";
const TEST_FACILITATOR_URL = "https://x402.org/facilitator";
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const PREPAY_LIMIT = 30;
const PREPAY_WINDOW_MS = 60_000;

export { X402_ROUTE_PATHS, X402_ROUTE_PRICES };

function searchFiltersSchema(fieldSchema: Record<string, unknown> = { type: "string", minLength: 1, maxLength: 64 }) {
  const scalarSchema = { oneOf: [{ type: "string", maxLength: 200 }, { type: "number" }, { type: "boolean" }] };
  const conditionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["field", "op"],
    properties: {
      field: fieldSchema,
      op: { enum: ["eq", "neq", "gte", "lte", "gt", "lt", "between", "in", "exists", "contains"] },
      value: scalarSchema,
      values: { type: "array", maxItems: 500, items: scalarSchema },
      min: { type: "number" },
      max: { type: "number" },
    },
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      all: { type: "array", maxItems: 50, items: conditionSchema },
      any: { type: "array", maxItems: 50, items: conditionSchema },
    },
  } as const;
}

const SEARCH_FILTERS_SCHEMA = searchFiltersSchema();
const COMPANY_SEARCH_FILTERS_SCHEMA = searchFiltersSchema({ enum: X402_COMPANY_PUBLIC_FIELDS });

const ESTIMATE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["filters"],
  properties: { filters: SEARCH_FILTERS_SCHEMA },
} as const;

const COMPANIES_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["filters"],
  properties: {
    filters: COMPANY_SEARCH_FILTERS_SCHEMA,
    fields: { type: "array", minItems: 1, maxItems: 20, items: { enum: X402_COMPANY_PUBLIC_FIELDS } },
    sort: {
      type: "object",
      additionalProperties: false,
      properties: {
        field: { enum: X402_COMPANY_PUBLIC_FIELDS },
        dir: { enum: ["asc", "desc"] },
      },
    },
    page: { type: "integer", minimum: 1, maximum: 500 },
    page_size: { type: "integer", minimum: 1, maximum: 50 },
  },
} as const;

export function buildX402Routes(payTo: string, network: string): RoutesConfig {
  return {
    [`POST ${X402_ROUTE_PATHS.estimate}`]: routeConfig({
      endpoint: "estimate",
      payTo,
      network,
      description: "Estimate a French B2B company segment before materializing leads.",
      inputSchema: ESTIMATE_BODY_SCHEMA,
      outputExample: { estimated_count: 42, actionable: { with_phone: 30, with_email: 20, with_phone_and_email: 15 } },
    }),
    [`POST ${X402_ROUTE_PATHS.companies}`]: routeConfig({
      endpoint: "companies",
      payTo,
      network,
      description: "Return one paid, capped page of French B2B companies for a validated segment.",
      inputSchema: COMPANIES_BODY_SCHEMA,
      outputExample: { total_exact: 1, total_is_capped: false, page: 1, page_size: 25, results: [{ siren: "451556062" }] },
    }),
  };
}

function routeConfig(args: {
  endpoint: X402Endpoint;
  payTo: string;
  network: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputExample: unknown;
}): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: args.network as `${string}:${string}`,
      payTo: args.payTo,
      price: X402_ROUTE_PRICES[args.endpoint],
    },
    description: args.description,
    mimeType: "application/json",
    serviceName: "Veridian Prospection",
    tags: ["prospection", "b2b", "france", "companies"],
    extensions: {
      ...declareDiscoveryExtension({
        bodyType: "json",
        inputSchema: args.inputSchema,
        output: { example: args.outputExample },
      }),
    },
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "payment_required",
        endpoint: args.endpoint,
        price: X402_ROUTE_PRICES[args.endpoint],
        network: args.network,
      },
    }),
    settlementFailedResponseBody: () => ({
      contentType: "application/json",
      body: { error: "payment_settlement_failed" },
    }),
  };
}

export function createX402RouteHandler(endpoint: X402Endpoint, handler: Handler): Handler {
  return async (request) => {
    if (process.env.X402_ENABLED !== "1") {
      const redirect = redirectDisabledX402ToCanonical(request, X402_ROUTE_PATHS[endpoint]);
      if (redirect) return redirect;
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let server: x402HTTPResourceServer;
    try {
      server = getX402HTTPServer();
    } catch (error) {
      console.error("[x402] configuration failed", error);
      return NextResponse.json({ error: "x402_not_configured" }, { status: 503 });
    }
    return protectX402Request({
      request,
      endpoint,
      routePath: X402_ROUTE_PATHS[endpoint],
      handler,
      server,
    });
  };
}

export async function protectX402Request(args: {
  request: NextRequest;
  endpoint: X402Endpoint;
  routePath: string;
  handler: Handler;
  server: x402HTTPResourceServer;
}): Promise<NextResponse> {
  const context = createRequestContext(args.request);
  if (!args.server.requiresPayment(context)) {
    return NextResponse.json({ error: "x402_route_not_protected" }, { status: 500 });
  }

  if (!context.paymentHeader && prepaymentLimited(args.request, args.endpoint)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    await initializeServer(args.server);
  } catch (error) {
    const facilitatorError = getFacilitatorResponseError(error);
    if (facilitatorError) return facilitatorErrorResponse(facilitatorError);
    console.error("[x402] initialization failed", error);
    return NextResponse.json({ error: "x402_not_configured" }, { status: 500 });
  }

  let result;
  try {
    result = await args.server.processHTTPRequest(context);
  } catch (error) {
    if (error instanceof FacilitatorResponseError) return facilitatorErrorResponse(error);
    console.error("[x402] payment verification failed", error);
    return NextResponse.json({ error: "x402_verification_failed" }, { status: 500 });
  }

  if (result.type === "payment-error") return httpInstructionsToResponse(result.response);
  if (result.type === "no-payment-required") {
    return NextResponse.json({ error: "x402_route_not_protected" }, { status: 500 });
  }

  let response: NextResponse;
  try {
    response = await args.handler(args.request);
  } catch (error) {
    const cancelSettlement = await result.cancellationDispatcher.cancel({ reason: "handler_threw", error });
    if (!result.beforeHandlerSettlement && !cancelSettlement) throw error;
    const errorResponse = NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    attachFailureSettlementHeaders(args.server, errorResponse, result, cancelSettlement);
    return errorResponse;
  }

  if (response.status >= 400) {
    const cancelSettlement = await result.cancellationDispatcher.cancel({
      reason: "handler_failed",
      responseStatus: response.status,
    });
    response.headers.delete(SETTLEMENT_OVERRIDES_HEADER);
    attachFailureSettlementHeaders(args.server, response, result, cancelSettlement);
    return response;
  }

  const body = Buffer.from(await response.clone().arrayBuffer());
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const settlement = await args.server.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
    { request: context, responseBody: body, responseHeaders },
    undefined,
    result.beforeHandlerSettlement,
  );

  if (!settlement.success) return httpInstructionsToResponse(settlement.response);
  Object.entries(settlement.headers).forEach(([key, value]) => response.headers.set(key, value));
  response.headers.set("Cache-Control", withPrivateCacheControl(response.headers.get("Cache-Control")));
  response.headers.delete(SETTLEMENT_OVERRIDES_HEADER);
  return response;
}

let cachedServer: { key: string; server: x402HTTPResourceServer } | undefined;

function getX402HTTPServer(): x402HTTPResourceServer {
  const payTo = getPayTo();
  const network = getNetwork();
  const facilitatorUrl = getFacilitatorUrl(network);
  const key = `${payTo}|${network}|${facilitatorUrl}`;
  if (cachedServer?.key === key) return cachedServer.server;

  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const server = new x402ResourceServer(facilitator)
    .register(network as `${string}:${string}`, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const routes = buildX402Routes(payTo, network);
  validateBazaarRouteExtensions(routes);
  cachedServer = { key, server: new x402HTTPResourceServer(server, routes) };
  return cachedServer.server;
}

function getPayTo(): string {
  const payTo = process.env.X402_PAY_TO;
  if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new Error("X402_PAY_TO must be a valid EVM address");
  }
  return payTo;
}

function getNetwork(): string {
  const configured = process.env.X402_NETWORK;
  if (!configured) {
    throw new Error("X402_NETWORK must be configured when X402_ENABLED=1");
  }
  if (configured !== BASE_SEPOLIA && configured !== BASE_MAINNET) {
    throw new Error(`Unsupported X402_NETWORK: ${configured}`);
  }
  return configured;
}

function getFacilitatorUrl(network: string): string {
  return process.env.X402_FACILITATOR_URL || (network === BASE_MAINNET ? CDP_FACILITATOR_URL : TEST_FACILITATOR_URL);
}

function createRequestContext(request: NextRequest): HTTPRequestContext {
  const adapter = new NextRequestAdapter(request);
  return {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
  };
}

class NextRequestAdapter implements HTTPAdapter {
  constructor(private readonly request: NextRequest) {}

  getHeader(name: string): string | undefined {
    return this.request.headers.get(name) || undefined;
  }

  getMethod(): string {
    return this.request.method;
  }

  getPath(): string {
    return getUrl(this.request).pathname;
  }

  getUrl(): string {
    return getUrl(this.request).toString();
  }

  getAcceptHeader(): string {
    return this.request.headers.get("accept") || "";
  }

  getUserAgent(): string {
    return this.request.headers.get("user-agent") || "";
  }

  getQueryParams(): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};
    getUrl(this.request).searchParams.forEach((value, key) => {
      const existing = params[key];
      if (Array.isArray(existing)) existing.push(value);
      else if (existing) params[key] = [existing, value];
      else params[key] = value;
    });
    return params;
  }

  getQueryParam(name: string): string | string[] | undefined {
    const values = getUrl(this.request).searchParams.getAll(name);
    if (values.length === 0) return undefined;
    return values.length === 1 ? values[0] : values;
  }

  async getBody(): Promise<unknown> {
    try {
      return await this.request.clone().json();
    } catch {
      return undefined;
    }
  }
}

function getUrl(request: NextRequest): URL {
  const requestUrl = request.nextUrl ?? new URL(request.url);
  const configuredOrigin = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!configuredOrigin) return requestUrl;

  try {
    const publicUrl = new URL(configuredOrigin);
    if (publicUrl.protocol !== "https:" && publicUrl.protocol !== "http:") return requestUrl;
    publicUrl.pathname = requestUrl.pathname;
    publicUrl.search = requestUrl.search;
    publicUrl.hash = "";
    return publicUrl;
  } catch {
    return requestUrl;
  }
}

const initializedServers = new WeakSet<x402HTTPResourceServer>();
const initializingServers = new WeakMap<x402HTTPResourceServer, Promise<void>>();

async function initializeServer(server: x402HTTPResourceServer): Promise<void> {
  if (initializedServers.has(server)) return;
  let promise = initializingServers.get(server);
  if (!promise) {
    promise = server.initialize();
    initializingServers.set(server, promise);
  }
  await promise;
  initializedServers.add(server);
}

function prepaymentLimited(request: NextRequest, endpoint: X402Endpoint): boolean {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return isRateLimited(`x402-prepay:${endpoint}:${ip}`, PREPAY_LIMIT, PREPAY_WINDOW_MS);
}

function httpInstructionsToResponse(response: { status: number; headers: Record<string, string>; body?: unknown; isHtml?: boolean }): NextResponse {
  const headers = new Headers(response.headers);
  if (response.isHtml) {
    headers.set("Content-Type", "text/html");
    return new NextResponse(response.body as BodyInit, { status: response.status, headers });
  }
  headers.set("Content-Type", "application/json");
  return NextResponse.json(response.body ?? {}, { status: response.status, headers });
}

function facilitatorErrorResponse(error: FacilitatorResponseError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: 502 });
}

function attachFailureSettlementHeaders(
  server: x402HTTPResourceServer,
  response: NextResponse,
  result: PaymentVerifiedResult,
  cancelSettlement: CancelSettlement,
): void {
  const headers = server.createFailurePathSettlementHeaders(
    cancelSettlement,
    result.beforeHandlerSettlement,
    result.paymentPayload,
    response.headers.get("Cache-Control"),
  );
  if (headers) Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
}
