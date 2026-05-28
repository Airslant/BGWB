import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { getAdminAnalytics } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  return NextResponse.json(getAdminAnalytics());
}
