import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import { importAdminTranslationMarkdown } from "@/lib/db";
import { assertSameOriginRequest } from "@/lib/request-security";

export const runtime = "nodejs";

const MAX_TRANSLATION_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const originError = assertSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const admin = await getCurrentAdminUser();

  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 Markdown 翻译文件。" }, { status: 400 });
  }

  if (file.size > MAX_TRANSLATION_FILE_BYTES) {
    return NextResponse.json({ error: "翻译文件不能超过 5MB。" }, { status: 413 });
  }

  const markdown = (await file.text()).trim();

  if (!markdown) {
    return NextResponse.json({ error: "翻译文件为空。" }, { status: 400 });
  }

  const result = importAdminTranslationMarkdown(markdown);

  return NextResponse.json({ result });
}
