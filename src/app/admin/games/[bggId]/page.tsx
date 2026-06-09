import { AdminGameDetailClient } from "@/components/admin-clients";

type AdminGamePageProps = {
  params: Promise<{ bggId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function AdminGamePage({ params, searchParams }: AdminGamePageProps) {
  const { bggId } = await params;
  const query = await searchParams;

  return <AdminGameDetailClient bggId={bggId} returnTo={query.returnTo} />;
}
