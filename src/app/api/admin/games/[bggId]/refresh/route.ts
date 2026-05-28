import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { refreshBggThing } from "@/lib/bgg";
import { getAdminGameDetail } from "@/lib/db";
import { normalizeLocale } from "@/lib/i18n";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ bggId: string }>;
};

async function getBggId(context: RouteContext) {
  const params = await context.params;
  return params.bggId;
}

export async function POST(request: Request, context: RouteContext) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const bggId = await getBggId(context);

  if (!/^\d+$/.test(bggId)) {
    return NextResponse.json({ error: "BGG ID 必须是数字。" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    await refreshBggThing(bggId, normalizeLocale(searchParams.get("locale")));
    return NextResponse.json({ game: getAdminGameDetail(bggId) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "刷新 BGG 详情失败。" }, { status: 502 });
  }
}
