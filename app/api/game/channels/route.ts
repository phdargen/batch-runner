import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { channelToClientRecord, listPlayerChannels } from "@/lib/server/channels";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const payer = getAddress(address) as `0x${string}`;
  const channels = await listPlayerChannels(payer);

  return NextResponse.json({
    channels: channels.map(channelToClientRecord),
  });
}
