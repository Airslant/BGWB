import { NextResponse } from "next/server";

import { normalizeEmail, requestRegisterEmailCode, validateEmail } from "@/lib/auth";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const payload = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = normalizeEmail(payload.email);

  if (!validateEmail(email)) {
    return NextResponse.json({ error: "请输入有效邮箱。" }, { status: 400 });
  }

  try {
    const result = await requestRegisterEmailCode(email, request);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, cooldownSeconds: result.cooldownSeconds });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "验证码发送失败，请稍后再试。" }, { status: 500 });
  }
}
