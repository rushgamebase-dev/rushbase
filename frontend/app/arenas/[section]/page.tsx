import type { Metadata } from "next";
import RushArenasPage from "@/components/arenas/RushArenasPage";

export const metadata: Metadata = {
  title: "Rush Arenas — Rush Royale",
  description:
    "Rush Royale arena flows are moving under the Rush ecosystem on Base.",
};

export default function ArenaSectionPage() {
  return <RushArenasPage />;
}
