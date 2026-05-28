import { NextResponse } from "next/server";

import { logoutCurrentUser } from "@/lib/auth";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  await logoutCurrentUser();
  return NextResponse.json({ ok: true });
}
