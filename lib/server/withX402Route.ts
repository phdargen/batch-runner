import { NextAdapter } from "@x402/next";
import {
  FacilitatorResponseError,
  getFacilitatorResponseError,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type PaywallConfig,
  type PaywallProvider,
  type RouteConfig,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { NextRequest, NextResponse } from "next/server";
import { handleSettlement } from "./handleSettlement";

function createFacilitatorErrorResponse(error: FacilitatorResponseError): NextResponse {
  return new NextResponse(JSON.stringify({ error: error.message }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

function createRequestContext(request: NextRequest): HTTPRequestContext {
  const adapter = new NextAdapter(request);
  return {
    adapter,
    path: request.nextUrl.pathname,
    method: request.method,
    paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
  };
}

function handlePaymentError(response: HTTPResponseInstructions): NextResponse {
  const headers = new Headers(response.headers);
  if (response.isHtml) {
    headers.set("Content-Type", "text/html");
    return new NextResponse(response.body as string, {
      status: response.status,
      headers,
    });
  }
  headers.set("Content-Type", "application/json");
  return new NextResponse(JSON.stringify(response.body || {}), {
    status: response.status,
    headers,
  });
}

function prepareHttpServer(
  httpServer: x402HTTPResourceServer,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart = true,
) {
  if (paywall) {
    httpServer.registerPaywallProvider(paywall);
  }

  let initPromise: Promise<void> | null = syncFacilitatorOnStart ? httpServer.initialize() : null;
  let isInitialized = false;

  return {
    httpServer,
    async init() {
      if (!syncFacilitatorOnStart || isInitialized) {
        return;
      }
      if (!initPromise) {
        initPromise = httpServer.initialize();
      }
      try {
        await initPromise;
        isInitialized = true;
      } catch (error) {
        initPromise = null;
        throw error;
      }
    },
  };
}

/**
 * Like @x402/next withX402, but passes handler response headers into settlement
 * so setSettlementOverrides works as documented.
 */
export function withX402Route<T = unknown>(
  routeHandler: (request: NextRequest) => Promise<NextResponse<T>>,
  routeConfig: RouteConfig,
  server: x402ResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart = true,
): (request: NextRequest) => Promise<NextResponse<T>> {
  const httpServer = new x402HTTPResourceServer(server, { "*": routeConfig });
  const { init } = prepareHttpServer(httpServer, paywall, syncFacilitatorOnStart);

  return async (request): Promise<NextResponse<T>> => {
    await init();

    const context = createRequestContext(request);
    const result = await httpServer.processHTTPRequest(context, paywallConfig);

    switch (result.type) {
      case "no-payment-required":
        return routeHandler(request);
      case "payment-error":
        return handlePaymentError(result.response) as NextResponse<T>;
      case "payment-verified": {
        let handlerResponse: NextResponse<T>;
        try {
          handlerResponse = await routeHandler(request);
        } catch (error) {
          await result.cancellationDispatcher.cancel({
            reason: "handler_threw",
            error,
          });
          throw error;
        }
        return (await handleSettlement(
          httpServer,
          handlerResponse,
          result.paymentPayload,
          result.paymentRequirements,
          result.declaredExtensions,
          result.cancellationDispatcher,
          context,
        )) as NextResponse<T>;
      }
    }
  };
}

export function getRouteFacilitatorError(error: unknown): FacilitatorResponseError | undefined {
  return getFacilitatorResponseError(error);
}

export { createFacilitatorErrorResponse };
