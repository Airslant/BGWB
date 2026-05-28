import { NextResponse } from "next/server";

import { getBggThing } from "@/lib/bgg";
import { getCurrentUser } from "@/lib/auth";
import { normalizeLocale } from "@/lib/i18n";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ bggId: string }>;
};

async function getBggId(context: RouteContext) {
  const params = await context.params;
  return params.bggId;
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const bggId = await getBggId(context);
  const { searchParams } = new URL(request.url);
  const locale = normalizeLocale(searchParams.get("locale") ?? request.headers.get("accept-language"));

  if (!/^\d+$/.test(bggId)) {
    return NextResponse.json({ error: "BGG ID 必须是数字。" }, { status: 400 });
  }

  try {
    const game = await getBggThing(bggId, locale);
    return NextResponse.json({ game });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "BGG 详情获取失败，请稍后再试。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
