import { NextResponse } from "next/server";
import { verifyTypedData, getAddress, type Address } from "viem";
import { BATCH_SETTLEMENT_DOMAIN, BATCH_SETTLEMENT_ADDRESS, voucherTypes } from "@x402/evm";
import { resolveBasename } from "@/lib/server/basename";
import { leaderboardStorage, type LeaderboardEntry } from "@/lib/server/storage";
import { CHAIN_ID } from "@/lib/x402/config";

const MAX_ENTRIES = 100;

export const runtime = "nodejs";

export async function GET(req: Request) {
  const limitParam = new URL(req.url).searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : MAX_ENTRIES;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_ENTRIES)
    : MAX_ENTRIES;

  try {
    const leaderboard = await leaderboardStorage.get(limit);
    return NextResponse.json({ leaderboard });
  } catch (error) {
    console.error("[batch-runner] Failed to read leaderboard:", error);
    return NextResponse.json({ error: "Failed to read leaderboard" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { address, distance, voucherCount, lastVoucher, signerAddress } = body;

  if (!address || typeof distance !== "number" || typeof voucherCount !== "number") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Verify voucher signature if provided (signed by session key, not main wallet)
  if (lastVoucher?.channelId && lastVoucher?.signature && signerAddress) {
    try {
      const valid = await verifyTypedData({
        address: getAddress(signerAddress),
        domain: {
          ...BATCH_SETTLEMENT_DOMAIN,
          chainId: CHAIN_ID,
          verifyingContract: getAddress(BATCH_SETTLEMENT_ADDRESS),
        },
        types: voucherTypes,
        primaryType: "Voucher",
        message: {
          channelId: lastVoucher.channelId,
          maxClaimableAmount: BigInt(lastVoucher.maxClaimableAmount),
        },
        signature: lastVoucher.signature,
      });

      if (!valid) {
        return NextResponse.json({ error: "Invalid voucher signature" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid voucher signature" }, { status: 403 });
    }
  }

  const normalizedAddress = getAddress(address);
  const basename = await resolveBasename(normalizedAddress as Address);

  const entry: LeaderboardEntry = {
    address: normalizedAddress,
    ...(basename ? { basename } : {}),
    distance,
    voucherCount,
  };

  try {
    const result = await leaderboardStorage.record(entry, MAX_ENTRIES);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[batch-runner] Failed to record leaderboard entry:", error);
    return NextResponse.json({ error: "Failed to record leaderboard entry" }, { status: 500 });
  }
}
