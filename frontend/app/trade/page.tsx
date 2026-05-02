//! TapTrade arena route. Hosts the VRF arena UX — provably-fair
//! deterministic trajectory game with commit/reveal off-chain.
//!
//! Resolution comes from a per-bet VRF path (no Binance, no oracle).
//! The visual line is the in-process Rush Index emitted by the
//! engine's `arena_index` module via `prices:RUSH_INDEX` WS channel.

import RushArenaTradePage from "@/components/taptrade/RushArenaTradePage";
import { setRushArenaMockMode } from "@/lib/api/rushArenaClient";

// The arena defaults to live engine mode. Mock mode is opt-in for a
// future `/preview` sandbox; production never ships with mock = true.
setRushArenaMockMode(false);

export default function TradePage() {
  return <RushArenaTradePage />;
}
