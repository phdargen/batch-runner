import { convertToTokenAmount } from "@x402/core/utils";

export const NETWORK = "eip155:84532";
export const CHAIN_ID = 84532;
export const NEXT_DEV = process.env.NEXT_DEV === "true";

export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6;
const DEV_RECEIVER_ADDRESS = "0x0000000000000000000000000000000000000001";

function readPositiveInt(...keys: string[]): number | null {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined || raw === "") continue;

    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return null;
}

function readPriceDollars(...keys: string[]): string | null {
  for (const key of keys) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;

    const normalized = raw.startsWith("$") ? raw.slice(1) : raw;
    if (/^\d+(\.\d+)?$/.test(normalized)) return normalized;
  }

  return null;
}

function formatUsdPrice(units: bigint): string {
  return `$${(Number(units) / 10 ** USDC_DECIMALS).toString()}`;
}

/** Max jumps charged per game run (round budget). */
export const MAX_JUMPS_PER_RUN =
  readPositiveInt("NEXT_PUBLIC_MAX_JUMPS_PER_RUN", "MAX_JUMPS_PER_RUN") ?? 100;

/** USDC price for a full run (MAX_JUMPS_PER_RUN jumps). */
const RUN_MAX_PRICE_DOLLARS =
  readPriceDollars("NEXT_PUBLIC_RUN_MAX_PRICE", "RUN_MAX_PRICE") ?? "0.01";

export const JUMP_PRESET_MULTIPLIERS = [1, 2, 5, 10] as const;
export const DEFAULT_JUMP_PRESET_MULTIPLIER = 5;
export const MIN_DEPOSIT_MULTIPLIER = 1;
export const MAX_DEPOSIT_MULTIPLIER = 100;

export function jumpsForDepositMultiplier(multiplier: number): number {
  return multiplier * MAX_JUMPS_PER_RUN;
}

export const JUMP_PRESETS = JUMP_PRESET_MULTIPLIERS.map(jumpsForDepositMultiplier);
export const DEFAULT_JUMPS = jumpsForDepositMultiplier(DEFAULT_JUMP_PRESET_MULTIPLIER);
export const MIN_CUSTOM_JUMPS = jumpsForDepositMultiplier(MIN_DEPOSIT_MULTIPLIER);
export const MAX_CUSTOM_JUMPS = jumpsForDepositMultiplier(MAX_DEPOSIT_MULTIPLIER);

export const RUN_MAX_PRICE = `$${RUN_MAX_PRICE_DOLLARS}`;
export const RUN_PRICE_UNITS = BigInt(convertToTokenAmount(RUN_MAX_PRICE_DOLLARS, USDC_DECIMALS));
export const JUMP_COST_UNITS = RUN_PRICE_UNITS / BigInt(MAX_JUMPS_PER_RUN);

if (RUN_PRICE_UNITS % BigInt(MAX_JUMPS_PER_RUN) !== 0n) {
  throw new Error("RUN_MAX_PRICE must divide evenly by MAX_JUMPS_PER_RUN");
}

export const JUMP_PRICE = formatUsdPrice(JUMP_COST_UNITS);

export const DEV_ROUND_BUDGET_MULTIPLIER = 10;
export const DEV_ROUND_BUDGET_UNITS = RUN_PRICE_UNITS * BigInt(DEV_ROUND_BUDGET_MULTIPLIER);
export const VOUCHER_CHECKPOINT_JUMPS = 5;

export function roundBudgetUnits(): bigint {
  return NEXT_DEV ? DEV_ROUND_BUDGET_UNITS : RUN_PRICE_UNITS;
}

export const WITHDRAW_DELAY = 900; // 15 minutes (minimum)
export const STORAGE_DIR = process.env.STORAGE_DIR || "/tmp/x402-batch-runner-channels";

export const FACILITATOR_URL =
  process.env.FACILITATOR_URL ||
  process.env.NEXT_PUBLIC_FACILITATOR_URL ||
  "https://x402.org/facilitator";

export const RECEIVER_ADDRESS = (process.env.EVM_ADDRESS ||
  process.env.NEXT_PUBLIC_RECEIVER_ADDRESS ||
  (NEXT_DEV ? DEV_RECEIVER_ADDRESS : "") ||
  "") as `0x${string}`;
