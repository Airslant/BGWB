import { AdminGamesClient } from "@/components/admin-clients";

type AdminGamesPageProps = {
  searchParams: Promise<{ page?: string; q?: string }>;
};

function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export default async function AdminGamesPage({ searchParams }: AdminGamesPageProps) {
  const params = await searchParams;

  return <AdminGamesClient initialPage={parsePage(params.page)} initialQuery={params.q ?? ""} />;
}
