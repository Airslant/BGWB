import { getCurrentAdminUser } from "@/lib/auth";
import { buildAdminPendingTranslationMarkdown } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const admin = await getCurrentAdminUser();

  if (!admin) {
    return Response.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const exportResult = buildAdminPendingTranslationMarkdown();

  return new Response(exportResult.markdown, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${exportResult.filename}"`,
      "Content-Type": "text/markdown; charset=utf-8",
      "X-BGWB-Translation-Names": String(exportResult.counts.names),
      "X-BGWB-Translation-Categories": String(exportResult.counts.categories),
      "X-BGWB-Translation-Mechanics": String(exportResult.counts.mechanics),
      "X-BGWB-Translation-Descriptions": String(exportResult.counts.descriptions)
    }
  });
}
