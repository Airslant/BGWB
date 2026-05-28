import { NextResponse } from "next/server";

import { getSharedBoard } from "@/lib/db";
import { normalizeLocale } from "@/lib/i18n";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ shareId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { shareId } = await context.params;
  const { searchParams } = new URL(request.url);
  const locale = normalizeLocale(searchParams.get("locale") ?? request.headers.get("accept-language"));
  const board = getSharedBoard(shareId, locale);

  if (!board) {
    return NextResponse.json({ error: "没有找到这个分享白板。" }, { status: 404 });
  }

  return NextResponse.json({ board });
}
