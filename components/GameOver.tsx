"use client";

import { useEffect, useRef, useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { DINO_JUMP_FRAME, getDinoAtlasFrameBackground } from "@/lib/game/sprites";

type GameOverProps = {
  distance: number;
  voucherCount: number;
  rank: number | null;
  onPlayAgain: () => void;
};

const DINO_DISPLAY_HEIGHT = 72;
const dinoSprite = getDinoAtlasFrameBackground(DINO_JUMP_FRAME, DINO_DISPLAY_HEIGHT);

export function GameOver({ distance, voucherCount, rank, onPlayAgain }: GameOverProps) {
  const distanceFormatted = Math.floor(distance).toLocaleString();
  const leaderboardRef = useRef<HTMLDivElement>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  useEffect(() => {
    if (!showLeaderboard) return;
    leaderboardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [showLeaderboard]);

  const scrollToLeaderboard = () => {
    setShowLeaderboard(true);
  };

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-black/60 backdrop-blur-sm">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="game-over-shell animate-slide-up flex flex-col items-center gap-3 pointer-events-auto">
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

          <div className="game-over-actions">
            <button type="button" onClick={onPlayAgain} className="game-over-replay">
              Play Again
            </button>
            <button type="button" onClick={scrollToLeaderboard} className="game-over-replay game-over-secondary">
              Leaderboard
            </button>
          </div>

          {showLeaderboard && (
            <div ref={leaderboardRef} id="leaderboard" className="game-over-leaderboard">
              <Leaderboard />
            </div>
          )}
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
