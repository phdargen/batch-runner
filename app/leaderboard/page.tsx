"use client";

import Link from "next/link";
import { Leaderboard } from "@/components/Leaderboard";

export default function LeaderboardPage() {
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
      </div>

      <div className="leaderboard-page-content animate-slide-up">
        <div className="leaderboard-page-header">
          <img src="/logo.png" alt="Batch Runner" className="leaderboard-page-logo" width={1536} height={1024} />
        </div>

        <Leaderboard limit={100} scrollable title="Leaderboard" />
      </div>
    </main>
  );
}
