import { NextResponse } from "next/server";
import { getAddress, type Hash } from "viem";
import { readOnChainChannelBalance } from "@/lib/server/channelBalance";
import { getRefundedAmountFromReceipt } from "@/lib/server/settleReceipt";
import { flowStatsStorage } from "@/lib/server/storage";
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
  const channelIdHex = channelId as `0x${string}`;
  const channel = await storage.get(channelIdHex);
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  if (getAddress(channel.channelConfig.payer) !== payer) {
    return NextResponse.json({ error: "Channel does not belong to this wallet" }, { status: 403 });
  }

  const charged = BigInt(channel.chargedCumulativeAmount ?? "0");
  const onChainBalance = await readOnChainChannelBalance(channelIdHex);
  const refundableAmount = onChainBalance > charged ? onChainBalance - charged : 0n;
  if (refundableAmount <= 0n) {
    return NextResponse.json({ error: "Channel has no remaining balance" }, { status: 400 });
  }

  // Keep server storage aligned with chain so the refund payload amount is correct.
  await storage.updateChannel(channelIdHex, current => {
    if (!current) return current;
    return { ...current, balance: onChainBalance.toString() };
  });

  try {
    const results = await channelManager.refund([channelIdHex]);
    if (results.length === 0) {
      return NextResponse.json({ error: "Refund failed" }, { status: 502 });
    }

    const txHash = results[0].transaction as Hash;
    const refundedAmount = (await getRefundedAmountFromReceipt(txHash, payer)) || refundableAmount;
    await flowStatsStorage.recordRefund(refundedAmount);

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
