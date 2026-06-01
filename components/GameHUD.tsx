"use client";

import { FuelMeter } from "./FuelMeter";

type GameHUDProps = {
  distance: number;
  remainingJumps: number;
  maxJumps: number;
};

export function GameHUD({ distance, remainingJumps, maxJumps }: GameHUDProps) {
  const distanceFormatted = Math.floor(distance).toLocaleString();

  return (
    <div className="absolute top-0 left-0 right-0 p-3 pointer-events-none select-none z-10">
      <div className="hud-panel flex items-center gap-3 max-w-[min(100%,22rem)] ml-auto">
        <DistanceReadout value={distanceFormatted} />

        <div className="hud-divider" aria-hidden />

        <FuelMeter remaining={remainingJumps} max={maxJumps} />
      </div>
    </div>
  );
}

function DistanceReadout({ value }: { value: string }) {
  return (
    <div className="flex items-baseline gap-0.5 justify-center min-w-[4.5rem]">
      <span className="hud-distance tabular-nums">{value}</span>
      <span className="hud-unit">m</span>
    </div>
  );
}
