import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChannelStorage } from "@x402/evm/batch-settlement/server";
import { FileChannelStorage } from "@x402/evm/batch-settlement/server/file-storage";
import {
  RedisChannelStorage,
  type RedisChannelStorageClient,
  type RedisEvalOptions,
  type RedisScanOptions,
  type RedisSetOptions,
} from "@x402/evm/batch-settlement/server/redis-storage";
import { createClient } from "redis";

import { STORAGE_DIR } from "../x402/config";
import {
  computeEntryRank,
  sortLeaderboard,
  type LeaderboardEntry as SharedLeaderboardEntry,
} from "../leaderboard";
import { createFlowStatsStorage, type FlowStatsStorage } from "./flowStats";
import { createSettlementStatsStorage, type SettlementStatsStorage } from "./settlementStats";

const LEADERBOARD_KEY = "batch-runner:leaderboard";
const LEADERBOARD_STATS_KEY = "batch-runner:leaderboard:stats";
const LEADERBOARD_PLAYERS_KEY = "batch-runner:leaderboard:players";
const REDIS_KEY_PREFIX = "batch-runner";
const redisUrl = process.env.REDIS_URL?.trim();

const RECORD_LEADERBOARD_ENTRY_SCRIPT = `
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[2])
redis.call("HINCRBY", KEYS[2], "totalVouchers", ARGV[3])
redis.call("HINCRBY", KEYS[2], "totalGames", 1)
redis.call("SADD", KEYS[3], ARGV[4])
return redis.call("ZREVRANK", KEYS[1], ARGV[2])
`;

export type LeaderboardEntry = SharedLeaderboardEntry;

export type LeaderboardStats = {
  totalVouchers: number;
  totalGames: number;
  uniquePlayers: number;
};

type LeaderboardFile = {
  entries: LeaderboardEntry[];
  stats: LeaderboardStats;
};

export type LeaderboardSnapshot = LeaderboardFile;

export type LeaderboardRecordResult = {
  rank: number;
  leaderboard: LeaderboardSnapshot;
};

export type LeaderboardStorage = {
  get(max: number): Promise<LeaderboardSnapshot>;
  record(entry: LeaderboardEntry, max: number): Promise<LeaderboardRecordResult>;
};

type LazyRedisStorageClient = RedisChannelStorageClient & {
  hGetAll(key: string): Promise<Record<string, string>>;
  sCard(key: string): Promise<number>;
  zRevRangeWithScores(key: string, start: number, stop: number): Promise<string[]>;
};

function createLazyRedisStorageClient(url: string): {
  client: LazyRedisStorageClient;
  disconnect: () => Promise<void>;
} {
  const connect = async () => {
    const client = createClient({ url });
    client.on("error", err => {
      console.error("[batch-runner] Redis client error:", err);
    });
    await client.connect();
    return client;
  };

  let connecting: Promise<Awaited<ReturnType<typeof connect>>> | undefined;
  const ensureClient = () => {
    if (!connecting) connecting = connect();
    return connecting;
  };

  const disconnect = async () => {
    const client = await connecting;
    if (client?.isOpen) {
      await client.quit();
    }
  };

  const normalizeRedisString = (value: string | Buffer | null): string | null => {
    if (value == null) return null;
    return typeof value === "string" ? value : value.toString("utf8");
  };

  const normalizeScanKey = (key: string | Buffer): string =>
    typeof key === "string" ? key : key.toString("utf8");

  return {
    client: {
      get: key =>
        ensureClient()
          .then(client => client.get(key))
          .then(normalizeRedisString),
      set: (key, value, opts?: RedisSetOptions) =>
        ensureClient()
          .then(client => {
            if (opts?.NX) {
              return client.set(key, value, {
                NX: true,
                ...(opts.PX !== undefined ? { PX: opts.PX } : {}),
              });
            }

            if (opts?.PX !== undefined) {
              return client.set(key, value, { PX: opts.PX });
            }

            return client.set(key, value);
          })
          .then(normalizeRedisString),
      del: key =>
        ensureClient()
          .then(client => client.del(key))
          .then(count => Number(count)),
      eval: (script, options: RedisEvalOptions) =>
        ensureClient().then(client => client.eval(script, options)),
      scanIterator(options: RedisScanOptions): AsyncIterable<string | string[]> {
        return {
          async *[Symbol.asyncIterator]() {
            const client = await ensureClient();
            for await (const chunk of client.scanIterator(options)) {
              if (Array.isArray(chunk)) {
                yield chunk.map(normalizeScanKey);
                continue;
              }

              yield normalizeScanKey(chunk);
            }
          },
        };
      },
      hGetAll: key => ensureClient().then(client => client.hGetAll(key)),
      sCard: key =>
        ensureClient()
          .then(client => client.sendCommand(["SCARD", key]))
          .then(count => Number(count)),
      zRevRangeWithScores: (key, start, stop) =>
        ensureClient()
          .then(client => client.zRangeWithScores(key, start, stop, { REV: true }))
          .then(result => {
            const flat: string[] = [];
            for (const item of result) {
              flat.push(String(item.value));
              flat.push(String(item.score));
            }
            return flat;
          }),
    },
    disconnect,
  };
}

class RedisLeaderboardStorage implements LeaderboardStorage {
  constructor(private readonly client: LazyRedisStorageClient) {}

  async get(max: number): Promise<LeaderboardSnapshot> {
    const [entries, stats] = await Promise.all([this.listTop(max), this.getStats()]);
    return { entries, stats };
  }

  async record(entry: LeaderboardEntry, max: number): Promise<LeaderboardRecordResult> {
    const member = JSON.stringify(entry);
    await this.client.eval(RECORD_LEADERBOARD_ENTRY_SCRIPT, {
      keys: [LEADERBOARD_KEY, LEADERBOARD_STATS_KEY, LEADERBOARD_PLAYERS_KEY],
      arguments: [
        String(entry.distance),
        member,
        String(entry.voucherCount),
        entry.address.toLowerCase(),
      ],
    });

    const sorted = await this.listAllSorted();
    const stats = await this.getStats();

    return {
      rank: computeEntryRank(sorted, entry),
      leaderboard: {
        entries: sorted.slice(0, max),
        stats,
      },
    };
  }

  private async listAllSorted(): Promise<LeaderboardEntry[]> {
    const raw = await this.client.zRevRangeWithScores(LEADERBOARD_KEY, 0, -1);
    const entries: LeaderboardEntry[] = [];

    for (let i = 0; i < raw.length; i += 2) {
      entries.push(JSON.parse(raw[i]) as LeaderboardEntry);
    }

    return sortLeaderboard(entries);
  }

  private async listTop(max: number): Promise<LeaderboardEntry[]> {
    const sorted = await this.listAllSorted();
    return sorted.slice(0, max);
  }

  private async getStats(): Promise<LeaderboardStats> {
    const [storedStats, uniquePlayers] = await Promise.all([
      this.client.hGetAll(LEADERBOARD_STATS_KEY),
      this.client.sCard(LEADERBOARD_PLAYERS_KEY),
    ]);

    return {
      totalVouchers: Number(storedStats.totalVouchers ?? 0),
      totalGames: Number(storedStats.totalGames ?? 0),
      uniquePlayers,
    };
  }
}

class FileLeaderboardStorage implements LeaderboardStorage {
  private readonly filePath = join(STORAGE_DIR, "leaderboard.json");
  private readonly lockPath = `${this.filePath}.lock`;

  async get(max: number): Promise<LeaderboardSnapshot> {
    const file = await this.readFile();
    return {
      entries: file.entries.slice(0, max),
      stats: file.stats,
    };
  }

  async record(entry: LeaderboardEntry, max: number): Promise<LeaderboardRecordResult> {
    return this.withLock(async () => {
      const file = await this.readFile();
      const entries = [...file.entries, entry];

      const sorted = sortLeaderboard(entries);
      const stats = updateStats(file.stats, entry, sorted);
      await writeJsonAtomic(this.filePath, {
        entries: sorted,
        stats,
      });

      return {
        rank: computeEntryRank(sorted, entry, entry),
        leaderboard: {
          entries: sorted.slice(0, max),
          stats,
        },
      };
    });
  }

  private async readFile(): Promise<LeaderboardFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return parseLeaderboardFile(parsed);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyLeaderboardFile();
      throw err;
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.lockPath), { recursive: true });
    const lockHandle = await acquireLock(this.lockPath);

    try {
      return await fn();
    } finally {
      await lockHandle.close();
      await unlink(this.lockPath).catch(() => {});
    }
  }
}

function parseLeaderboardFile(value: unknown): LeaderboardFile {
  if (!value || typeof value !== "object") {
    throw new Error("Leaderboard file must contain entries and stats");
  }

  const file = value as Partial<LeaderboardFile>;
  if (!Array.isArray(file.entries)) {
    throw new Error("Leaderboard file entries must be an array");
  }

  return {
    entries: sortLeaderboard(file.entries),
    stats: parseLeaderboardStats(file.stats),
  };
}

function emptyLeaderboardFile(): LeaderboardFile {
  return {
    entries: [],
    stats: {
      totalVouchers: 0,
      totalGames: 0,
      uniquePlayers: 0,
    },
  };
}

function parseLeaderboardStats(stats: unknown): LeaderboardStats {
  if (!stats || typeof stats !== "object") {
    throw new Error("Leaderboard file stats must be an object");
  }

  const value = stats as Partial<LeaderboardStats>;
  const totalVouchers = readNonNegativeNumber(value.totalVouchers);
  const totalGames = readNonNegativeNumber(value.totalGames);
  const uniquePlayers = readNonNegativeNumber(value.uniquePlayers);

  if (totalVouchers === null || totalGames === null || uniquePlayers === null) {
    throw new Error("Leaderboard file stats must contain non-negative numbers");
  }

  return { totalVouchers, totalGames, uniquePlayers };
}

function updateStats(
  stats: LeaderboardStats,
  entry: LeaderboardEntry,
  entries: LeaderboardEntry[],
): LeaderboardStats {
  return {
    totalVouchers: stats.totalVouchers + entry.voucherCount,
    totalGames: stats.totalGames + 1,
    uniquePlayers: new Set(entries.map(item => item.address.toLowerCase())).size,
  };
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

async function acquireLock(lockPath: string) {
  while (true) {
    try {
      return await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFileJson(tempPath, value);
    await rename(tempPath, path);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

async function writeFileJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createBackendStorage(): {
  channelStorage: ChannelStorage;
  leaderboardStorage: LeaderboardStorage;
  settlementStatsStorage: SettlementStatsStorage;
  flowStatsStorage: FlowStatsStorage;
  storageBackend: "file" | "redis";
  disconnect?: () => Promise<void>;
} {
  if (!redisUrl) {
    return {
      channelStorage: new FileChannelStorage({ directory: STORAGE_DIR }),
      leaderboardStorage: new FileLeaderboardStorage(),
      settlementStatsStorage: createSettlementStatsStorage(undefined),
      flowStatsStorage: createFlowStatsStorage(undefined),
      storageBackend: "file",
    };
  }

  const { client, disconnect } = createLazyRedisStorageClient(redisUrl);
  return {
    channelStorage: new RedisChannelStorage({
      client,
      keyPrefix: `${REDIS_KEY_PREFIX}:x402`,
    }),
    leaderboardStorage: new RedisLeaderboardStorage(client),
    settlementStatsStorage: createSettlementStatsStorage(client),
    flowStatsStorage: createFlowStatsStorage(client),
    storageBackend: "redis",
    disconnect,
  };
}

const selectedStorage = createBackendStorage();

export const channelStorage = selectedStorage.channelStorage;
export const leaderboardStorage = selectedStorage.leaderboardStorage;
export const settlementStatsStorage = selectedStorage.settlementStatsStorage;
export const flowStatsStorage = selectedStorage.flowStatsStorage;
export const storageBackend = selectedStorage.storageBackend;

export async function closeStorage(): Promise<void> {
  await selectedStorage.disconnect?.();
}
