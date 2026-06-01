"use client";

import { useEffect, useState } from "react";

type WalletLabelProps = {
  address: `0x${string}`;
};

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatLabel(name: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(name) ? truncateAddress(name) : name;
}

export function WalletLabel({ address }: WalletLabelProps) {
  const [label, setLabel] = useState<string>(() => truncateAddress(address));

  useEffect(() => {
    let cancelled = false;

    setLabel(truncateAddress(address));

    fetch(`/api/basename?address=${encodeURIComponent(address)}`)
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (cancelled || typeof body?.name !== "string") return;
        setLabel(formatLabel(body.name));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <span className="text-sm text-[var(--color-text-secondary)] font-mono" title={address}>
      {label}
    </span>
  );
}
