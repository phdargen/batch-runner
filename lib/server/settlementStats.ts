import { USDC_DECIMALS } from "../x402/config";

const SETTLEMENT_STATS_KEY = "batch-runner:settlement:stats";

const RECORD_CLAIM_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "totalVouchersClaimed", ARGV[1])
return 1
`;

const RECORD_SETTLE_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "totalSettleTransactions", 1)
redis.call("HINCRBY", KEYS[1], "totalSettledAmount", ARGV[1])
return 1
`;

export type SettlementStats = {
  totalVouchersClaimed: number;
  totalSettleTransactions: number;
  totalSettledAmount: string;
};

export type SettlementStatsStorage = {
  get(): Promise<SettlementStats>;
  recordClaimedVouchers(vouchers: number): Promise<void>;
  recordSettle(amount: bigint): Promise<void>;
};

type StatsRedisClient = {
  hGetAll(key: string): Promise<Record<string, string>>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
};

function emptySettlementStats(): SettlementStats {
  return {
    totalVouchersClaimed: 0,
    totalSettleTransactions: 0,
    totalSettledAmount: "0",
  };
}

function parseSettlementStats(raw: Record<string, string>): SettlementStats {
  return {
    totalVouchersClaimed: Number(raw.totalVouchersClaimed ?? 0),
    totalSettleTransactions: Number(raw.totalSettleTransactions ?? 0),
    totalSettledAmount: raw.totalSettledAmount ?? "0",
  };
}

export function formatSettledUsd(units: bigint): string {
  return `$${(Number(units) / 10 ** USDC_DECIMALS).toString()}`;
}

class RedisSettlementStatsStorage implements SettlementStatsStorage {
  constructor(private readonly client: StatsRedisClient) {}

  async get(): Promise<SettlementStats> {
    const raw = await this.client.hGetAll(SETTLEMENT_STATS_KEY);
    return parseSettlementStats(raw);
  }

  async recordClaimedVouchers(vouchers: number): Promise<void> {
    if (vouchers <= 0) return;
    await this.client.eval(RECORD_CLAIM_SCRIPT, {
      keys: [SETTLEMENT_STATS_KEY],
      arguments: [String(vouchers)],
    });
  }

  async recordSettle(amount: bigint): Promise<void> {
    await this.client.eval(RECORD_SETTLE_SCRIPT, {
      keys: [SETTLEMENT_STATS_KEY],
      arguments: [amount.toString()],
    });
  }
}

const disabledSettlementStatsStorage: SettlementStatsStorage = {
  async get() {
    return emptySettlementStats();
  },
  async recordClaimedVouchers() {},
  async recordSettle() {},
};

export function createSettlementStatsStorage(
  redisClient: StatsRedisClient | undefined,
): SettlementStatsStorage {
  if (!redisClient) return disabledSettlementStatsStorage;
  return new RedisSettlementStatsStorage(redisClient);
}
