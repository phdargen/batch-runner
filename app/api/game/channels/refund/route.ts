import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { deactivatePlayerChannel } from "@/lib/server/channels";
import { channelManager, storage } from "@/lib/server/x402";

export const runtime = "nodejs";

type RefundRequest = {
  channelId?: string;
  address?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as RefundRequest;
  const { channelId, address } = body;

  if (!channelId || !/^0x[0-9a-fA-F]{64}$/.test(channelId)) {
    return NextResponse.json({ error: "Invalid channelId" }, { status: 400 });
  }

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const payer = getAddress(address);
  const channel = await storage.get(channelId);
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  if (getAddress(channel.channelConfig.payer) !== payer) {
    return NextResponse.json({ error: "Channel does not belong to this wallet" }, { status: 403 });
  }

  const balance = BigInt(channel.balance ?? "0");
  const charged = BigInt(channel.chargedCumulativeAmount ?? "0");
  if (balance <= charged) {
    return NextResponse.json({ error: "Channel has no remaining balance" }, { status: 400 });
  }

  try {
    const results = await channelManager.refund([channelId]);
    if (results.length === 0) {
      return NextResponse.json({ error: "Refund failed" }, { status: 502 });
    }

    await deactivatePlayerChannel(channelId as `0x${string}`);

    return NextResponse.json({
      ok: true,
      channelId: results[0].channel,
      transaction: results[0].transaction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refund failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
