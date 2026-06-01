"use client";

import { useEffect, useState } from "react";
import { scoreMatches, type LeaderboardEntry } from "@/lib/leaderboard";

function runnerLabel(entry: LeaderboardEntry): string {
  if (entry.basename) return entry.basename;
  return `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;
}

type LeaderboardResponse = {
  leaderboard: {
    entries: LeaderboardEntry[];
  };
};

export type HighlightRun = {
  address: string;
  distance: number;
  voucherCount: number;
};

type LeaderboardProps = {
  limit?: number;
  title?: string;
  scrollable?: boolean;
  highlightRun?: HighlightRun | null;
  refreshKey?: number;
};

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="leaderboard-medal" title="1st place" aria-label="1st place">
        <GoldMedalIcon />
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="leaderboard-medal" title="2nd place" aria-label="2nd place">
        <SilverMedalIcon />
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="leaderboard-medal" title="3rd place" aria-label="3rd place">
        <BronzeMedalIcon />
      </span>
    );
  }

  return <span className="leaderboard-rank">{rank}</span>;
}

export function Leaderboard({
  limit = 100,
  title,
  scrollable = false,
  highlightRun = null,
  refreshKey = 0,
}: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ limit: String(limit) });
    fetch(`/api/leaderboard?${params}`)
      .then(r => r.json())
      .then((data: LeaderboardResponse) => {
        if (cancelled) return;
        setEntries(data.leaderboard.entries);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [limit, refreshKey]);

  return (
    <div className="w-full max-w-md mx-auto">
      {title ? (
        <h3 className="text-sm font-bold text-[var(--color-text-secondary)] mb-3 uppercase tracking-wider">
          {title}
        </h3>
      ) : null}

      {loading ? (
        <div className="text-center text-xs text-[var(--color-text-secondary)] py-4">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center text-xs text-[var(--color-text-secondary)] py-4">
          No scores yet. Be the first!
        </div>
      ) : (
        <div
          className={`rounded-xl border border-[var(--color-surface-lighter)] overflow-hidden ${
            scrollable ? "leaderboard-scroll" : ""
          }`}
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]">
                <th className="py-2 px-3 text-left">#</th>
                <th className="py-2 px-3 text-left">Runner</th>
                <th className="py-2 px-3 text-right">Distance</th>
                <th className="py-2 px-3 text-right">Jumps</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const rank = i + 1;
                const highlighted = highlightRun ? scoreMatches(entry, highlightRun) : false;

                return (
                  <tr
                    key={`${entry.address}-${entry.distance}-${entry.voucherCount}-${i}`}
                    className={`border-t border-[var(--color-surface-lighter)] transition-colors ${
                      highlighted
                        ? "leaderboard-row-highlight"
                        : "hover:bg-[var(--color-surface-light)]"
                    }`}
                  >
                    <td className="py-2 px-3 font-bold text-[var(--color-base-blue)]">
                      <RankCell rank={rank} />
                    </td>
                    <td className="py-2 px-3 font-mono" title={entry.address}>
                      {runnerLabel(entry)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {Math.floor(entry.distance).toLocaleString()}m
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{entry.voucherCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GoldMedalIcon() {
  return (
    <svg className="leaderboard-medal-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="14" r="6" fill="#f5c518" />
      <circle cx="12" cy="14" r="4.5" fill="#ffe566" />
      <path d="M9 3 10.5 8H8l4 4 4-4h-2.5L15 3l-3 2.5L9 3Z" fill="#e6a800" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#9a6b00">
        1
      </text>
    </svg>
  );
}

function SilverMedalIcon() {
  return (
    <svg className="leaderboard-medal-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="14" r="6" fill="#b8bcc6" />
      <circle cx="12" cy="14" r="4.5" fill="#e3e6ee" />
      <path d="M9 3 10.5 8H8l4 4 4-4h-2.5L15 3l-3 2.5L9 3Z" fill="#8a909c" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#5c616b">
        2
      </text>
    </svg>
  );
}

function BronzeMedalIcon() {
  return (
    <svg className="leaderboard-medal-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="14" r="6" fill="#c97a3a" />
      <circle cx="12" cy="14" r="4.5" fill="#e8a56a" />
      <path d="M9 3 10.5 8H8l4 4 4-4h-2.5L15 3l-3 2.5L9 3Z" fill="#9a5520" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#6b3a12">
        3
      </text>
    </svg>
  );
}
