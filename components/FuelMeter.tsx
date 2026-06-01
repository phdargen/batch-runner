"use client";

type FuelMeterProps = {
  remaining: number;
  max: number;
  className?: string;
};

export function FuelMeter({ remaining, max, className = "" }: FuelMeterProps) {
  const energyRatio = max > 0 ? Math.min(1, remaining / max) : 0;
  const energyPercent = Math.round(energyRatio * 100);
  const lowEnergy = energyRatio <= 0.25;
  const criticalEnergy = energyRatio <= 0.1;
  const barTone = criticalEnergy ? "critical" : lowEnergy ? "low" : "normal";

  return (
    <div className={`flex flex-1 min-w-0 ${className}`.trim()}>
      <div
        className={`hud-energy-track ${barTone}`}
        role="progressbar"
        aria-valuenow={remaining}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label="Jump fuel"
      >
        <div className="hud-energy-fill" style={{ width: `${energyPercent}%` }}>
          <div className="hud-energy-glow" style={{ opacity: energyRatio }} />
        </div>
        <div className="hud-energy-segments" aria-hidden />
        <span className={`hud-energy-label hud-jump-count tabular-nums ${barTone}`}>
          {remaining}
          <span className="hud-jump-max">/{max}</span>
        </span>
      </div>
    </div>
  );
}
