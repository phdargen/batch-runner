export type LeaderboardEntry = {
  address: string;
  basename?: string | null;
  distance: number;
  voucherCount: number;
};

export function scoreMatches(
  a: Pick<LeaderboardEntry, "address" | "distance" | "voucherCount">,
  b: Pick<LeaderboardEntry, "address" | "distance" | "voucherCount">,
): boolean {
  return (
    a.address.toLowerCase() === b.address.toLowerCase() &&
    a.distance === b.distance &&
    a.voucherCount === b.voucherCount
  );
}

export function entriesMatch(a: LeaderboardEntry, b: LeaderboardEntry): boolean {
  return (
    scoreMatches(a, b) &&
    (a.basename ?? null) === (b.basename ?? null)
  );
}

export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.distance !== a.distance) return b.distance - a.distance;
    if (b.voucherCount !== a.voucherCount) return a.voucherCount - b.voucherCount;
    return a.address.localeCompare(b.address);
  });
}

export function findEntryRank(
  entries: LeaderboardEntry[],
  target: Pick<LeaderboardEntry, "address" | "distance" | "voucherCount">,
): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (scoreMatches(entries[i], target)) return i + 1;
  }
  return -1;
}

export function computeEntryRank(
  sorted: LeaderboardEntry[],
  entry: LeaderboardEntry,
  exactRef?: LeaderboardEntry,
): number {
  if (exactRef) {
    const refIndex = sorted.indexOf(exactRef);
    if (refIndex >= 0) return refIndex + 1;
  }

  return findEntryRank(sorted, entry);
}
