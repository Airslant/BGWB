import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getGameNaming, getGameSnapshot } from "@/lib/db";
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

export async function GET(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const bggId = await getBggId(context);
  const { searchParams } = new URL(request.url);
  const locale = normalizeLocale(searchParams.get("locale") ?? request.headers.get("accept-language"));

  if (!/^\d+$/.test(bggId)) {
    return NextResponse.json({ error: "BGG ID must be numeric." }, { status: 400 });
  }

  return NextResponse.json({
    naming: getGameNaming(bggId),
    game: getGameSnapshot(bggId, locale)
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const bggId = await getBggId(context);

  if (!/^\d+$/.test(bggId)) {
    return NextResponse.json({ error: "BGG ID must be numeric." }, { status: 400 });
  }

  return NextResponse.json({ error: "Game names and aliases are platform-maintained." }, { status: 403 });
}
