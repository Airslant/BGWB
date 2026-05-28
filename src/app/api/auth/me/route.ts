import { NextResponse } from "next/server";

import { deleteCurrentUserAccount, getCurrentUser, normalizeNickname, updateCurrentUserNickname } from "@/lib/auth";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const payload = (await request.json().catch(() => ({}))) as { nickname?: unknown };
  const result = await updateCurrentUserNickname(normalizeNickname(payload.nickname));

  if (!result.user) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ user: result.user });
}

export async function DELETE(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const payload = (await request.json().catch(() => ({}))) as { currentPassword?: unknown };
  const result = await deleteCurrentUserAccount(payload.currentPassword, request);

  if (!("ok" in result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
