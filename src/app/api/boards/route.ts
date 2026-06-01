import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { BoardLimitError, createBoard, listBoards } from "@/lib/db";
import { normalizeLocale } from "@/lib/i18n";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  return NextResponse.json({ boards: listBoards(user.id), maxBoards: user.maxBoards });
}

export async function POST(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const payload = (await request.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 20) : undefined;
    const board = createBoard(user.id, normalizeLocale(searchParams.get("locale")), title);
    return NextResponse.json(
      {
        board: {
          id: board.id,
          shareId: board.shareId,
          title: board.title,
          itemCount: 0,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof BoardLimitError) {
      return NextResponse.json({ error: `白板数量已达上限（${error.maxBoards} 个）。` }, { status: 403 });
    }

    console.error(error);
    return NextResponse.json({ error: "创建白板失败，请稍后再试。" }, { status: 500 });
  }
}
