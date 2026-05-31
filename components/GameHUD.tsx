"use client";

type GameHUDProps = {
  balance: number;
  distance: number;
  voucherCount: number;
};

export function GameHUD({ balance, distance, voucherCount }: GameHUDProps) {
  const balanceFormatted = (balance / 1e6).toFixed(3);
  const distanceFormatted = Math.floor(distance).toLocaleString();

  return (
    <div className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between
                    pointer-events-none select-none z-10">
      <div className="flex items-center gap-4 text-xs">
        <HUDStat
          icon="💰"
          value={`$${balanceFormatted}`}
          color={balance < 100000 ? "var(--color-accent-red)" : "var(--color-accent-green)"}
        />
        <HUDStat icon="🤖" value={`${distanceFormatted}m`} color="var(--color-base-blue-light)" />
        <HUDStat icon="✍️" value={`${voucherCount}`} color="var(--color-text-secondary)" />
      </div>
    </div>
  );
}

function HUDStat({ icon, value, color }: { icon: string; value: string; color: string }) {
  return (
    <span className="flex items-center gap-1">
      <span>{icon}</span>
      <span style={{ color }} className="font-bold tabular-nums">
        {value}
      </span>
    </span>
  );
}
