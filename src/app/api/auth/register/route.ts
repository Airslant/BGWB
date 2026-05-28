import { NextResponse } from "next/server";

import {
  normalizeEmail,
  normalizeEmailCode,
  normalizeNickname,
  registerUserWithCode,
  validateEmail,
  validateEmailCode,
  validateNickname,
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
    nickname?: unknown;
    password?: unknown;
    code?: unknown;
  };
  const email = normalizeEmail(payload.email);
  const nickname = normalizeNickname(payload.nickname);
  const code = normalizeEmailCode(payload.code);

  if (!validateEmail(email)) {
    return NextResponse.json({ error: "请输入有效邮箱。" }, { status: 400 });
  }

  if (!validateNickname(nickname)) {
    return NextResponse.json({ error: "请输入 1-20 个字符的昵称。" }, { status: 400 });
  }

  if (!validatePassword(payload.password)) {
    return NextResponse.json({ error: "密码至少需要 8 位。" }, { status: 400 });
  }

  if (!validateEmailCode(code)) {
    return NextResponse.json({ error: "请输入 6 位验证码。" }, { status: 400 });
  }

  try {
    const result = await registerUserWithCode(email, nickname, payload.password as string, code);

    if (!result.user) {
      return NextResponse.json({ error: result.error ?? "注册失败。" }, { status: result.status ?? 400 });
    }

    return NextResponse.json({ user: result.user }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "这个邮箱已经注册。" }, { status: 409 });
  }
}
