import { NextRequest, NextResponse } from "next/server";

import { settleFunds } from "@/lib/server/cronJobs";
import { authorizeCronRequest } from "@/lib/server/cronAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const result = await settleFunds();
  return NextResponse.json(result);
}
