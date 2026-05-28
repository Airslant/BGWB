import { BoardClient } from "@/components/board-client";

type BoardPageProps = {
  params: Promise<{ boardId: string }>;
};

export default async function BoardPage({ params }: BoardPageProps) {
  const { boardId } = await params;
  return <BoardClient boardId={boardId} />;
}
