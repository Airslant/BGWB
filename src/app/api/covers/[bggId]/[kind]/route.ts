import { NextResponse } from "next/server";

import { isCoverKind, readCachedCoverAsset } from "@/lib/cover-cache";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    bggId: string;
    kind: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { bggId, kind } = await context.params;

  if (!/^\d+$/.test(bggId) || !isCoverKind(kind)) {
    return NextResponse.json({ error: "Invalid cover path." }, { status: 400 });
  }

  const asset = await readCachedCoverAsset(bggId, kind);

  if (!asset) {
    return NextResponse.json({ error: "Cover not cached." }, { status: 404 });
  }

  return new Response(asset.bytes, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(asset.bytes.byteLength),
      "Content-Type": asset.contentType,
      "X-BGWB-Cover-Cached-At": asset.cachedAt
    }
  });
}
