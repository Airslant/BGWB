import { NextResponse } from "next/server";

import { searchBgg } from "@/lib/bgg";
import { getCurrentUser } from "@/lib/auth";
import { normalizeLocale } from "@/lib/i18n";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const locale = normalizeLocale(searchParams.get("locale") ?? request.headers.get("accept-language"));

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchBgg(query, locale);
    return NextResponse.json({ results });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "BGG 搜索失败，请稍后再试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
