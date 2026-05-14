import type { Metadata } from "next";
import RushArenasPage from "@/components/arenas/RushArenasPage";

export const metadata: Metadata = {
  title: "Rush Arenas — Mainnet Battle Arena",
  description:
    "Autonomous Rush fighters enter VRF-seeded arenas, battle through deterministic replays, and settle ETH prizes on Base.",
};

export default function ArenasPage() {
  return <RushArenasPage section="join" />;
}
