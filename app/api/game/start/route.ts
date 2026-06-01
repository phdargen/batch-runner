import { NextRequest, NextResponse } from "next/server";
import { setSettlementOverrides } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { server, receiverAddress } from "@/lib/server/x402";
import { withX402Route } from "@/lib/server/withX402Route";
import { NETWORK, JUMP_PRICE } from "@/lib/x402/config";

export const runtime = "nodejs";

const handler = async (_: NextRequest) => {
  const res = NextResponse.json({ ok: true, message: "Play at https://batch-runner.vercel.app/" });
  setSettlementOverrides(res, { amount: "0" });
  return res;
};

export const GET = withX402Route(
  handler,
  "GET /api/game/start",
  {
    accepts: [
      {
        scheme: "batch-settlement",
        price: JUMP_PRICE,
        network: NETWORK,
        payTo: receiverAddress,
      },
    ],
    description:
      "Batch Runner: fund a batch-settlement channel with USDC on Base Sepolia. Each jump costs a micro-payment via locally signed vouchers — how far can you get Rex402 with 100 jumps?",
    mimeType: "application/json",
    serviceName: "Batch Runner",
    tags: ["game", "batch-settlement", "x402"],
    extensions: {
      ...declareDiscoveryExtension({
        output: {
          example: {
            ok: true,
            message: "Play at https://batch-runner.vercel.app/",
          },
          schema: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              message: { type: "string" },
            },
            required: ["ok", "message"],
          },
        },
      }),
    },
  },
  server,
);
