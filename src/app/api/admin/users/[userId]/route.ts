import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { getUserById, setUserDisabled, updateUserMaxBoards } from "@/lib/db";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

async function getUserId(context: RouteContext) {
  const params = await context.params;
  return params.userId;
}

export async function PATCH(request: Request, context: RouteContext) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const userId = await getUserId(context);
  const target = getUserById(userId);

  if (!target) {
    return NextResponse.json({ error: "没有找到这个用户。" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as { disabled?: unknown; reason?: unknown; maxBoards?: unknown };

  if (payload.maxBoards !== undefined) {
    const maxBoards = Number(payload.maxBoards);

    if (!Number.isInteger(maxBoards) || maxBoards < 0 || maxBoards > 500) {
      return NextResponse.json({ error: "白板上限需要是 0-500 之间的整数。" }, { status: 400 });
    }

    const updatedUser = updateUserMaxBoards(userId, maxBoards);
    return NextResponse.json({ user: updatedUser });
  }

  const disabled = Boolean(payload.disabled);

  if (disabled && target.id === admin.id) {
    return NextResponse.json({ error: "不能禁用自己的管理员账号。" }, { status: 400 });
  }

  if (disabled && target.role === "admin") {
    return NextResponse.json({ error: "不能禁用管理员账号。" }, { status: 400 });
  }

  const updatedUser = setUserDisabled(userId, disabled, typeof payload.reason === "string" ? payload.reason : "");

  return NextResponse.json({ user: updatedUser });
}
