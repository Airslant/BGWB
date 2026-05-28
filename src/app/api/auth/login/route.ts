import { NextResponse } from "next/server";

import { loginUser, normalizeEmail, validateEmail, validatePassword } from "@/lib/auth";
import { assertSameOriginRequest, consumeRateLimit, getClientIp, rateLimitResponse, resetRateLimit } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const payload = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = normalizeEmail(payload.email);
  const rateLimitKey = `login:${email || "invalid"}:${getClientIp(request)}`;
  const rateLimit = consumeRateLimit(rateLimitKey, {
    limit: 8,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000
  });

  if (!rateLimit.ok) {
    return rateLimitResponse(rateLimit.retryAfterSeconds);
  }

  if (!validateEmail(email) || !validatePassword(payload.password)) {
    return NextResponse.json({ error: "邮箱或密码不正确。" }, { status: 401 });
  }

  const result = await loginUser(email, payload.password as string);

  if (!result.user) {
    return NextResponse.json({ error: result.error ?? "邮箱或密码不正确。" }, { status: 401 });
  }

  resetRateLimit(rateLimitKey);
  return NextResponse.json({ user: result.user });
}
