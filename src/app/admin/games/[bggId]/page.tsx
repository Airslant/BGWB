import { AdminGameDetailClient } from "@/components/admin-clients";

type AdminGamePageProps = {
  params: Promise<{ bggId: string }>;
};

export default async function AdminGamePage({ params }: AdminGamePageProps) {
  const { bggId } = await params;
  return <AdminGameDetailClient bggId={bggId} />;
}
