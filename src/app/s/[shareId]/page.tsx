import { BoardClient } from "@/components/board-client";

type SharedBoardPageProps = {
  params: Promise<{ shareId: string }>;
};

export default async function SharedBoardPage({ params }: SharedBoardPageProps) {
  const { shareId } = await params;
  return <BoardClient apiPath={`/api/share/${shareId}`} backHref="/" boardId={shareId} mode="view" />;
}
