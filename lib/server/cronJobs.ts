import { channelManager } from "./x402";
import { settlementStatsStorage } from "./storage";
import { getSettledAmountFromReceipt } from "./settleReceipt";

export const MAX_CLAIMS_PER_BATCH = 100;

export type ClaimJobResult = {
  claimBatches: number;
  vouchers: number;
  claimTransactions: string[];
};

export type SettleJobResult = {
  transaction: string | null;
  settledAmount?: string;
  skipped?: boolean;
  error?: string;
};

export async function claimVouchers(): Promise<ClaimJobResult> {
  const claims = await channelManager.claim({ maxClaimsPerBatch: MAX_CLAIMS_PER_BATCH });
  const result = {
    claimBatches: claims.length,
    vouchers: claims.reduce((total, claim) => total + claim.vouchers, 0),
    claimTransactions: claims.map(claim => claim.transaction),
  };

  if (result.vouchers > 0) {
    await settlementStatsStorage.recordClaimedVouchers(result.vouchers);
  }

  return result;
}

export async function settleFunds(): Promise<SettleJobResult> {
  try {
    const settle = await channelManager.settle();
    const settledAmount = await getSettledAmountFromReceipt(settle.transaction as `0x${string}`);
    await settlementStatsStorage.recordSettle(settledAmount);
    return {
      transaction: settle.transaction,
      settledAmount: settledAmount.toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { transaction: null, skipped: true, error: message };
  }
}
