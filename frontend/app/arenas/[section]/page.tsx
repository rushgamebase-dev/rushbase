import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RushArenasPlayPage from "@/components/arenas/RushArenasPlayPage";

export const metadata: Metadata = {
  title: "Rush Arenas — Rush Royale",
  description:
    "Rush Royale arena flows are moving under the Rush ecosystem on Base.",
};

const arenaSections = ["fleet", "watch", "ledger"] as const;

type ArenaSection = (typeof arenaSections)[number];

export function generateStaticParams() {
  return arenaSections.map((section) => ({ section }));
}

export default function ArenaSectionPage({
  params,
  searchParams,
}: {
  params: { section: string };
  searchParams?: { arenaId?: string | string[]; arena?: string | string[] };
}) {
  if (!arenaSections.includes(params.section as ArenaSection)) {
    notFound();
  }

  return <RushArenasPlayPage section={params.section as ArenaSection} initialArenaId={singleSearchParam(searchParams?.arenaId ?? searchParams?.arena)} />;
}

function singleSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}
