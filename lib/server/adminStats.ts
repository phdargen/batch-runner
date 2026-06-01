import type { Channel } from "@x402/evm/batch-settlement/server";

import { USDC_DECIMALS } from "../x402/config";
import { channelStorage, leaderboardStorage, settlementStatsStorage, storageBackend } from "./storage";
import { formatSettledUsd } from "./settlementStats";

export type AdminStats = {
  storageBackend: "file" | "redis";
  leaderboard: {
    totalVouchers: number;
    totalGames: number;
    uniquePlayers: number;
  };
  channels: {
    totalChannels: number;
    channelsWithClaimable: number;
    totalClaimableAmount: string;
    totalClaimableUsd: string;
  };
  settlement: {
    totalVouchersClaimed: number;
    totalSettleTransactions: number;
    totalSettledAmount: string;
    totalSettledUsd: string;
  };
};

function getChannelClaimableAmount(channel: Channel): bigint {
  const charged = BigInt(channel.chargedCumulativeAmount ?? "0");
  const claimed = BigInt(channel.totalClaimed ?? "0");
  if (charged <= claimed) return 0n;
  return charged - claimed;
}

function formatUsdc(units: bigint): string {
  return `$${(Number(units) / 10 ** USDC_DECIMALS).toString()}`;
}

export async function getAdminStats(): Promise<AdminStats> {
  const [leaderboard, channels, settlement] = await Promise.all([
    leaderboardStorage.get(1),
    channelStorage.list(),
    settlementStatsStorage.get(),
  ]);

  let channelsWithClaimable = 0;
  let totalClaimable = 0n;

  for (const channel of channels) {
    const claimable = getChannelClaimableAmount(channel);
    if (claimable <= 0n) continue;
    channelsWithClaimable += 1;
    totalClaimable += claimable;
  }

  return {
    storageBackend,
    leaderboard: leaderboard.stats,
    channels: {
      totalChannels: channels.length,
      channelsWithClaimable,
      totalClaimableAmount: totalClaimable.toString(),
      totalClaimableUsd: formatUsdc(totalClaimable),
    },
    settlement: {
      totalVouchersClaimed: settlement.totalVouchersClaimed,
      totalSettleTransactions: settlement.totalSettleTransactions,
      totalSettledAmount: settlement.totalSettledAmount,
      totalSettledUsd: formatSettledUsd(BigInt(settlement.totalSettledAmount)),
    },
  };
}
