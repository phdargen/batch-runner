import type { PaymentPayload } from "@x402/core/types";

import { USDC_DECIMALS } from "../x402/config";

const FLOW_STATS_KEY = "batch-runner:flow:stats";

const RECORD_DEPOSIT_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "totalDepositTransactions", 1)
redis.call("HINCRBY", KEYS[1], "totalDepositedAmount", ARGV[1])
return 1
`;

const RECORD_REFUND_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "totalRefundRequests", 1)
redis.call("HINCRBY", KEYS[1], "totalRefundedAmount", ARGV[1])
return 1
`;

export type FlowStats = {
  totalDepositTransactions: number;
  totalDepositedAmount: string;
  totalRefundRequests: number;
  totalRefundedAmount: string;
};

export type FlowStatsStorage = {
  get(): Promise<FlowStats>;
  recordDeposit(amount: bigint): Promise<void>;
  recordRefund(amount: bigint): Promise<void>;
};

type StatsRedisClient = {
  hGetAll(key: string): Promise<Record<string, string>>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
};

function emptyFlowStats(): FlowStats {
  return {
    totalDepositTransactions: 0,
    totalDepositedAmount: "0",
    totalRefundRequests: 0,
    totalRefundedAmount: "0",
  };
}

function parseFlowStats(raw: Record<string, string>): FlowStats {
  return {
    totalDepositTransactions: Number(raw.totalDepositTransactions ?? 0),
    totalDepositedAmount: raw.totalDepositedAmount ?? "0",
    totalRefundRequests: Number(raw.totalRefundRequests ?? 0),
    totalRefundedAmount: raw.totalRefundedAmount ?? "0",
  };
}

export function formatFlowUsd(units: bigint): string {
  return `$${(Number(units) / 10 ** USDC_DECIMALS).toString()}`;
}

export function getDepositAmountFromPayment(paymentPayload: PaymentPayload): bigint | null {
  const raw = paymentPayload.payload;
  if (typeof raw !== "object" || raw === null || (raw as { type?: string }).type !== "deposit") {
    return null;
  }

  const amount = (raw as { deposit?: { amount?: string } }).deposit?.amount;
  if (!amount || !/^\d+$/.test(amount)) return null;
  return BigInt(amount);
}

class RedisFlowStatsStorage implements FlowStatsStorage {
  constructor(private readonly client: StatsRedisClient) {}

  async get(): Promise<FlowStats> {
    const raw = await this.client.hGetAll(FLOW_STATS_KEY);
    return parseFlowStats(raw);
  }

  async recordDeposit(amount: bigint): Promise<void> {
    if (amount <= 0n) return;
    await this.client.eval(RECORD_DEPOSIT_SCRIPT, {
      keys: [FLOW_STATS_KEY],
      arguments: [amount.toString()],
    });
  }

  async recordRefund(amount: bigint): Promise<void> {
    if (amount <= 0n) return;
    await this.client.eval(RECORD_REFUND_SCRIPT, {
      keys: [FLOW_STATS_KEY],
      arguments: [amount.toString()],
    });
  }
}

const disabledFlowStatsStorage: FlowStatsStorage = {
  async get() {
    return emptyFlowStats();
  },
  async recordDeposit() {},
  async recordRefund() {},
};

export function createFlowStatsStorage(redisClient: StatsRedisClient | undefined): FlowStatsStorage {
  if (!redisClient) return disabledFlowStatsStorage;
  return new RedisFlowStatsStorage(redisClient);
}
