import { NextResponse } from "next/server";
import { getAddress } from "viem";

export function getAdminWallet(): `0x${string}` | null {
  const raw = process.env.ADMIN_WALLET?.trim();
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return getAddress(raw) as `0x${string}`;
}

export function isAdminAddress(address: string): boolean {
  const adminWallet = getAdminWallet();
  if (!adminWallet || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  return getAddress(address) === adminWallet;
}

export function authorizeAdminAddress(address: string): NextResponse | null {
  const adminWallet = getAdminWallet();
  if (!adminWallet) {
    return NextResponse.json({ error: "Admin not configured" }, { status: 503 });
  }

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  if (getAddress(address) !== adminWallet) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  return null;
}
