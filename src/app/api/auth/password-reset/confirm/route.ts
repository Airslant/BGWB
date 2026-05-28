import { NextResponse } from "next/server";

import {
  normalizeEmail,
  normalizeEmailCode,
  resetPasswordWithCode,
  validateEmail,
  validateEmailCode,
  validatePassword
} from "@/lib/auth";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const payload = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    password?: unknown;
    code?: unknown;
  };
  const email = normalizeEmail(payload.email);
  const code = normalizeEmailCode(payload.code);

  if (!validateEmail(email)) {
    return NextResponse.json({ error: "请输入有效邮箱。" }, { status: 400 });
  }

  if (!validateEmailCode(code)) {
    return NextResponse.json({ error: "请输入 6 位验证码。" }, { status: 400 });
  }

  if (!validatePassword(payload.password)) {
    return NextResponse.json({ error: "密码至少需要 8 位。" }, { status: 400 });
  }

  try {
    const result = await resetPasswordWithCode(email, payload.password as string, code);

    if (!result.user) {
      return NextResponse.json({ error: result.error ?? "密码重置失败。" }, { status: result.status ?? 400 });
    }

    return NextResponse.json({ user: result.user });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "密码重置失败，请稍后再试。" }, { status: 500 });
  }
}
