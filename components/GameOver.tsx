"use client";

import Link from "next/link";
import { Leaderboard, type HighlightRun } from "@/components/Leaderboard";
import { DINO_JUMP_FRAME, getDinoAtlasFrameBackground } from "@/lib/game/sprites";

type GameOverProps = {
  distance: number;
  voucherCount: number;
  rank: number | null;
  highlightRun: HighlightRun | null;
  leaderboardRefreshKey: number;
  onPlayAgain: () => void;
  onBackToDeposit: () => void;
};

const DINO_DISPLAY_HEIGHT = 72;
const dinoSprite = getDinoAtlasFrameBackground(DINO_JUMP_FRAME, DINO_DISPLAY_HEIGHT);

export function GameOver({
  distance,
  voucherCount,
  rank,
  highlightRun,
  leaderboardRefreshKey,
  onPlayAgain,
  onBackToDeposit,
}: GameOverProps) {
  const distanceFormatted = Math.floor(distance).toLocaleString();

  return (
    <div className="game-over-overlay">
      <div className="game-over-shell animate-slide-up pointer-events-auto">
        <div className="game-over-nav">
          <button type="button" onClick={onBackToDeposit} className="game-over-replay game-over-secondary">
            Home
          </button>
          <Link href="/leaderboard" className="game-over-replay game-over-secondary game-over-nav-link">
            Leaderboard
          </Link>
        </div>

        <div className="hud-panel game-over-panel flex items-stretch">
          <div className="game-over-dino" aria-hidden>
            <div
              className="game-over-dino-sprite"
              style={{
                width: dinoSprite.width,
                height: dinoSprite.height,
                backgroundImage: dinoSprite.backgroundImage,
                backgroundSize: dinoSprite.backgroundSize,
                backgroundPosition: dinoSprite.backgroundPosition,
              }}
            />
          </div>

          <div className="game-over-perforation" aria-hidden />

          <div className="game-over-voucher">
            <VoucherStat label="Distance" value={distanceFormatted} unit="m" highlight />
            <VoucherStat label="Jumps" value={String(voucherCount)} />
            {rank !== null && <VoucherStat label="Rank" value={`#${rank}`} />}
          </div>
        </div>

        <button type="button" onClick={onPlayAgain} className="game-over-replay game-over-play-again">
          Play Again
        </button>

        <div id="leaderboard" className="game-over-leaderboard">
          <Leaderboard
            limit={5}
            highlightRun={highlightRun}
            refreshKey={leaderboardRefreshKey}
          />
        </div>
      </div>
    </div>
  );
}

function VoucherStat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  return (
    <div className="game-over-stat">
      <span className="game-over-stat-label">{label}</span>
      <div className="flex items-baseline gap-0.5">
        <span className={highlight ? "hud-distance tabular-nums" : "game-over-stat-value tabular-nums"}>
          {value}
        </span>
        {unit && <span className="hud-unit">{unit}</span>}
      </div>
    </div>
  );
}
