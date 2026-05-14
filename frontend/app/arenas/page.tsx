import type { Metadata } from "next";
import RushArenasPlayPage from "@/components/arenas/RushArenasPlayPage";

export const metadata: Metadata = {
  title: "Rush Arenas — Mainnet Battle Arena",
  description:
    "Autonomous Rush fighters enter VRF-seeded arenas, battle through deterministic replays, and settle ETH prizes on Base.",
};

export default function ArenasPage({
  searchParams,
}: {
  searchParams?: { arenaId?: string | string[]; arena?: string | string[] };
}) {
  return <RushArenasPlayPage section="join" initialArenaId={singleSearchParam(searchParams?.arenaId ?? searchParams?.arena)} />;
}

function singleSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}
