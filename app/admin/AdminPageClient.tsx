"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";

import { WalletConnect, type BaseAuthSession } from "@/components/WalletConnect";

type AdminStats = {
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
  flow: {
    totalDepositTransactions: number;
    totalDepositedAmount: string;
    totalDepositedUsd: string;
    totalRefundRequests: number;
    totalRefundedAmount: string;
    totalRefundedUsd: string;
  };
};

type AdminStatsResponse = {
  stats: AdminStats;
};

type AdminPageClientProps = {
  adminWallet: `0x${string}` | null;
};

export function AdminPageClient({ adminWallet }: AdminPageClientProps) {
  const [session, setSession] = useState<BaseAuthSession | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = useMemo(() => {
    if (!adminWallet || !session) return false;
    return getAddress(session.address) === adminWallet;
  }, [adminWallet, session]);

  useEffect(() => {
    if (!isAdmin || !session) {
      setStats(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: session.address }),
    })
      .then(async response => {
        const data = (await response.json()) as AdminStatsResponse & { error?: string };
        if (cancelled) return;

        if (!response.ok) {
          setStats(null);
          setError(data.error ?? "Failed to load admin stats");
          return;
        }

        setStats(data.stats);
      })
      .catch(() => {
        if (!cancelled) {
          setStats(null);
          setError("Failed to load admin stats");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, session]);

  return (
    <main className="leaderboard-page">
      <div
        className="leaderboard-page-bg bg-[var(--color-base-blue-dark)] bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/bkg.png)" }}
        aria-hidden
      />
      <div className="leaderboard-page-overlay" aria-hidden />

      <div className="deposit-page-actions">
        <Link href="/" className="deposit-btn deposit-play-btn deposit-leaderboard-btn">
          Back
        </Link>
        <div className="deposit-wallet">
          <WalletConnect session={session} onSignIn={setSession} onSignOut={() => setSession(null)} />
        </div>
      </div>

      <div className="leaderboard-page-content animate-slide-up">
        <div className="leaderboard-page-header">
          <img src="/logo.png" alt="Batch Runner" className="leaderboard-page-logo" width={1536} height={1024} />
          <h1 className="admin-page-title">Admin</h1>
        </div>

        {!adminWallet ? (
          <p className="admin-page-message admin-page-error">ADMIN_WALLET is not configured.</p>
        ) : !session ? (
          <p className="admin-page-message">Sign in with the admin wallet to view stats.</p>
        ) : !isAdmin ? (
          <p className="admin-page-message admin-page-error">Unauthorized</p>
        ) : loading ? (
          <p className="admin-page-message">Loading stats…</p>
        ) : error ? (
          <p className="admin-page-message admin-page-error">{error}</p>
        ) : stats ? (
          <div className="admin-stats">
            <section className="admin-stats-section">
              <h2 className="admin-stats-heading">Leaderboard</h2>
              <dl className="admin-stats-grid">
                <Stat label="Total vouchers" value={stats.leaderboard.totalVouchers.toLocaleString()} />
                <Stat label="Total games" value={stats.leaderboard.totalGames.toLocaleString()} />
                <Stat label="Unique players" value={stats.leaderboard.uniquePlayers.toLocaleString()} />
              </dl>
            </section>

            <section className="admin-stats-section">
              <h2 className="admin-stats-heading">Channels ({stats.storageBackend})</h2>
              <dl className="admin-stats-grid">
                <Stat label="Total channels" value={stats.channels.totalChannels.toLocaleString()} />
                <Stat
                  label="Channels with claimable"
                  value={stats.channels.channelsWithClaimable.toLocaleString()}
                />
                <Stat label="Total claimable" value={stats.channels.totalClaimableUsd} />
              </dl>
            </section>

            <section className="admin-stats-section">
              <h2 className="admin-stats-heading">Settlement ({stats.storageBackend})</h2>
              <dl className="admin-stats-grid">
                <Stat
                  label="Vouchers claimed (cron)"
                  value={stats.settlement.totalVouchersClaimed.toLocaleString()}
                />
                <Stat
                  label="Settle transactions"
                  value={stats.settlement.totalSettleTransactions.toLocaleString()}
                />
                <Stat label="Total settled" value={stats.settlement.totalSettledUsd} />
              </dl>
            </section>

            <section className="admin-stats-section">
              <h2 className="admin-stats-heading">Deposits & refunds ({stats.storageBackend})</h2>
              <dl className="admin-stats-grid">
                <Stat
                  label="Deposit transactions"
                  value={stats.flow.totalDepositTransactions.toLocaleString()}
                />
                <Stat label="Total deposited" value={stats.flow.totalDepositedUsd} />
                <Stat
                  label="Refund requests"
                  value={stats.flow.totalRefundRequests.toLocaleString()}
                />
                <Stat label="Total refunded" value={stats.flow.totalRefundedUsd} />
              </dl>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-stat">
      <dt className="admin-stat-label">{label}</dt>
      <dd className="admin-stat-value">{value}</dd>
    </div>
  );
}
