import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { resolveBasename } from "@/lib/server/basename";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const normalized = getAddress(address);

  if (!process.env.RPC_URL?.trim()) {
    return NextResponse.json(
      { name: normalized },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  }

  const name = await resolveBasename(normalized);

  return NextResponse.json(
    { name: name ?? normalized },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
