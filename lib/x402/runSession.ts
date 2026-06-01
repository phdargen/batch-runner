import type { SessionInfo } from "@/components/DepositFlow";
import { availableChannelBalance } from "@/lib/x402/browserStorage";
import { JUMP_COST_UNITS, NEXT_DEV, roundBudgetUnits } from "@/lib/x402/config";

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export async function prepareNextRunSession(session: SessionInfo): Promise<SessionInfo | null> {
  if (NEXT_DEV) {
    const budget = roundBudgetUnits();
    return {
      ...session,
      channelBalance: budget,
      chargedCumulativeAmount: 0n,
      roundBudget: budget,
    };
  }

  const channelId = session.channelId;
  if (!channelId || !session.channelConfig) return null;

  const context = await session.storage.get(channelId);
  const available = availableChannelBalance(context);
  if (available < JUMP_COST_UNITS) return null;

  const perRunBudget = minBigInt(available, roundBudgetUnits());

  return {
    ...session,
    channelBalance: BigInt(context?.balance ?? "0"),
    chargedCumulativeAmount: BigInt(context?.chargedCumulativeAmount ?? context?.totalClaimed ?? "0"),
    roundBudget: perRunBudget,
  };
}
