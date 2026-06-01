import { NextRequest, NextResponse } from "next/server";
import { setSettlementOverrides } from "@x402/next";
import { server, receiverAddress } from "@/lib/server/x402";
import { withX402Route } from "@/lib/server/withX402Route";
import { NETWORK, JUMP_PRICE } from "@/lib/x402/config";

export const runtime = "nodejs";

const handler = async (_: NextRequest) => {
  const res = NextResponse.json({ ok: true, message: "Channel funded — game on!" });
  setSettlementOverrides(res, { amount: "0" });
  return res;
};

export const GET = withX402Route(
  handler,
  {
    accepts: [
      {
        scheme: "batch-settlement",
        price: JUMP_PRICE,
        network: NETWORK,
        payTo: receiverAddress,
      },
    ],
    description: "Batch Runner game session deposit",
    mimeType: "application/json",
  },
  server,
);
