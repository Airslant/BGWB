import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { getAdminGameDetail, updateAdminGameMaintenance } from "@/lib/db";
import { assertSameOriginRequest } from "@/lib/request-security";
import type { AdminTermTranslation, LocalizedAliases, LocalizedText } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ bggId: string }>;
};

async function getBggId(context: RouteContext) {
  const params = await context.params;
  return params.bggId;
}

function isValidBggId(value: string) {
  return /^\d+$/.test(value);
}

function sanitizeTermTranslations(value: unknown): AdminTermTranslation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const row = entry as Partial<AdminTermTranslation>;
      return {
        term: typeof row.term === "string" ? row.term.trim().slice(0, 120) : "",
        translation: typeof row.translation === "string" ? row.translation.trim().slice(0, 120) : ""
      };
    })
    .filter((entry) => entry.term);
}

function sanitizeAliases(value: unknown): LocalizedAliases {
  if (!value || typeof value !== "object") {
    return {};
  }

  const aliases = value as Partial<Record<"en" | "zh-CN", unknown>>;

  return {
    en: Array.isArray(aliases.en) ? aliases.en.map((alias) => String(alias).trim()).filter(Boolean).slice(0, 24) : [],
    "zh-CN": Array.isArray(aliases["zh-CN"])
      ? aliases["zh-CN"].map((alias) => String(alias).trim()).filter(Boolean).slice(0, 24)
      : []
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const bggId = await getBggId(context);

  if (!isValidBggId(bggId)) {
    return NextResponse.json({ error: "BGG ID 必须是数字。" }, { status: 400 });
  }

  const game = getAdminGameDetail(bggId);

  if (!game) {
    return NextResponse.json({ error: "没有找到这个桌游。" }, { status: 404 });
  }

  return NextResponse.json({ game });
}

export async function PUT(request: Request, context: RouteContext) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const bggId = await getBggId(context);

  if (!isValidBggId(bggId)) {
    return NextResponse.json({ error: "BGG ID 必须是数字。" }, { status: 400 });
  }

  if (!getAdminGameDetail(bggId)) {
    return NextResponse.json({ error: "没有找到这个桌游。" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    localizedNames?: LocalizedText;
    aliases?: LocalizedAliases;
    zhDescription?: unknown;
    categoryTranslations?: unknown;
    mechanicTranslations?: unknown;
  };
  const game = updateAdminGameMaintenance(bggId, {
    localizedNames: {
      en: typeof payload.localizedNames?.en === "string" ? payload.localizedNames.en.trim().slice(0, 160) : undefined,
      "zh-CN":
        typeof payload.localizedNames?.["zh-CN"] === "string" ? payload.localizedNames["zh-CN"].trim().slice(0, 160) : undefined
    },
    aliases: sanitizeAliases(payload.aliases),
    zhDescription: typeof payload.zhDescription === "string" ? payload.zhDescription.trim().slice(0, 1200) : "",
    categoryTranslations: sanitizeTermTranslations(payload.categoryTranslations),
    mechanicTranslations: sanitizeTermTranslations(payload.mechanicTranslations)
  });

  return NextResponse.json({ game });
}
