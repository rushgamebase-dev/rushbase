"use client";

/**
 * Offline sandbox for the Rush Arena canvas.
 *
 * `/trade` is auth-gated (SIWE → JWT cookie) and talks to the live
 * engine. That makes UX iteration painful when the engine is down
 * or you just want to inspect cell rendering / multipliers / canvas
 * geometry. `/preview` short-circuits both:
 *
 *  - `setRushArenaMockMode(true)` flips the rushArenaClient into
 *    its built-in seeded-mock branch (`isRushArenaMockMode()` checks
 *    inside every endpoint return canned responses — see
 *    `lib/api/rushArenaClient.ts`).
 *  - `bypassAuthGate` tells `RushArenaTradePage` to skip the
 *    `/trade/connect` redirect, so the dashboard renders without
 *    a wallet connected.
 *
 * Use this to validate empirical-pricing changes (e.g. tweaks to
 * `EMPIRICAL_SAFETY_FACTOR` in `lib/taptrade/empiricalPricing.ts`)
 * before wiring the engine for real bets.
 */

import RushArenaTradePage from "@/components/taptrade/RushArenaTradePage";
import { setRushArenaMockMode } from "@/lib/api/rushArenaClient";

// Set the override at module load — BEFORE the rushArenaClient
// captures it inside any of its endpoint guards, and before
// `RushArenaTradePage` mounts and starts firing requests.
setRushArenaMockMode(true);

export default function PreviewPage() {
  return <RushArenaTradePage bypassAuthGate />;
}
