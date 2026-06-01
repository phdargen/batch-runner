import { NextResponse } from "next/server";

import { authorizeAdminAddress } from "@/lib/server/adminAuth";
import { getAdminStats } from "@/lib/server/adminStats";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = (await req.json()) as { address?: string };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const unauthorized = authorizeAdminAddress(body.address ?? "");
  if (unauthorized) return unauthorized;

  try {
    const stats = await getAdminStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[batch-runner] Failed to read admin stats:", error);
    return NextResponse.json({ error: "Failed to read admin stats" }, { status: 500 });
  }
}
