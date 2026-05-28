import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { listAdminGames } from "@/lib/db";

export const runtime = "nodejs";

function parsePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export async function GET(request: Request) {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);

  return NextResponse.json(
    listAdminGames({
      query: searchParams.get("q") ?? "",
      page: parsePage(searchParams.get("page"))
    })
  );
}
