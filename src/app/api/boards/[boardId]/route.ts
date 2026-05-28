import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { sanitizeBoardPayload } from "@/lib/board-validation";
import { deleteBoard, getOwnedBoard, saveBoard } from "@/lib/db";
import { normalizeLocale } from "@/lib/i18n";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ boardId: string }>;
};

async function getBoardId(context: RouteContext) {
  const params = await context.params;
  return params.boardId;
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const boardId = await getBoardId(context);
  const { searchParams } = new URL(request.url);
  const locale = normalizeLocale(searchParams.get("locale") ?? request.headers.get("accept-language"));
  const board = getOwnedBoard(boardId, user.id, locale);

  if (!board) {
    return NextResponse.json({ error: "没有找到这个白板，或你没有权限访问。" }, { status: 404 });
  }

  return NextResponse.json({ board });
}

export async function PUT(request: Request, context: RouteContext) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const boardId = await getBoardId(context);
  const { searchParams } = new URL(request.url);
  const locale = normalizeLocale(searchParams.get("locale") ?? request.headers.get("accept-language"));
  const existing = getOwnedBoard(boardId, user.id, locale);

  if (!existing) {
    return NextResponse.json({ error: "没有找到这个白板，或你没有权限访问。" }, { status: 404 });
  }

  try {
    const payload = await request.json();
    const board = sanitizeBoardPayload(boardId, existing, payload);
    const savedBoard = saveBoard(board, locale);
    return NextResponse.json({ board: savedBoard });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "保存失败，请检查白板数据。" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const boardId = await getBoardId(context);
  const deleted = deleteBoard(boardId, user.id);

  if (!deleted) {
    return NextResponse.json({ error: "没有找到这个白板，或你没有权限删除。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
