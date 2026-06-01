import { NextResponse } from "next/server";
import {
  FacilitatorResponseError,
  SETTLEMENT_OVERRIDES_HEADER,
  type HTTPRequestContext,
  type PaymentCancellationDispatcher,
  type ProcessSettleFailureResponse,
  x402HTTPResourceServer,
} from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

import { getDepositAmountFromPayment } from "./flowStats";
import { flowStatsStorage } from "./storage";

function responseHeadersFromNextResponse(response: NextResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function createFacilitatorErrorResponse(error: FacilitatorResponseError): NextResponse {
  return new NextResponse(JSON.stringify({ error: error.message }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Next.js settlement handler with responseHeaders wired for setSettlementOverrides.
 * @x402/next 2.14.0 sets Settlement-Overrides on the handler response but does not
 * pass those headers into processSettlement.
 */
export async function handleSettlement(
  httpServer: x402HTTPResourceServer,
  response: NextResponse,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  declaredExtensions: Record<string, unknown> | undefined,
  cancellationDispatcher: PaymentCancellationDispatcher,
  httpContext?: HTTPRequestContext,
): Promise<NextResponse> {
  if (response.status >= 400) {
    await cancellationDispatcher.cancel({
      reason: "handler_failed",
      responseStatus: response.status,
    });
    return response;
  }

  try {
    const responseBody = Buffer.from(await response.clone().arrayBuffer());
    const responseHeaders = responseHeadersFromNextResponse(response);

    const result = await httpServer.processSettlement(
      paymentPayload,
      paymentRequirements,
      declaredExtensions,
      httpContext ? { request: httpContext, responseBody, responseHeaders } : undefined,
    );

    if (!result.success) {
      const failure = result as ProcessSettleFailureResponse;
      const body = failure.response.isHtml
        ? (failure.response.body as string)
        : JSON.stringify(failure.response.body ?? {});
      return new NextResponse(body, {
        status: failure.response.status,
        headers: failure.response.headers,
      });
    }

    Object.entries(result.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    response.headers.delete(SETTLEMENT_OVERRIDES_HEADER);

    if (httpContext?.path === "/api/game/start") {
      const depositAmount = getDepositAmountFromPayment(paymentPayload);
      if (depositAmount !== null) {
        await flowStatsStorage.recordDeposit(depositAmount);
      }
    }

    return response;
  } catch (error) {
    if (error instanceof FacilitatorResponseError) {
      return createFacilitatorErrorResponse(error);
    }
    console.error("Settlement failed:", error);
    return new NextResponse(JSON.stringify({}), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });
  }
}
