import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { listAdminUsers } from "@/lib/db";

export const runtime = "nodejs";

function parsePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseStatus(value: string | null): "all" | "active" | "disabled" {
  return value === "active" || value === "disabled" ? value : "all";
}

export async function GET(request: Request) {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);

  return NextResponse.json(
    listAdminUsers({
      query: searchParams.get("q") ?? "",
      status: parseStatus(searchParams.get("status")),
      page: parsePage(searchParams.get("page"))
    })
  );
}
