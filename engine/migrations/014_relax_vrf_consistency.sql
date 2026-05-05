-- 2026-05-04: arena_index replaced the per-bet VRF resolver.
-- The new flow records `path_points_hash` (hash of the index path
-- the resolver actually walked) but no longer produces a per-bet
-- `revealed_seed` — there is a single global seed exposed via
-- `arena_index::seed_hash` instead.
--
-- The original constraint required revealed_seed and path_points_hash
-- to either both be NULL or both be NOT NULL. Under arena_index that
-- pairing no longer holds: revealed_seed is always NULL and
-- path_points_hash is always set on resolved bets.
--
-- Replace the strict pair constraint with a one-way invariant:
-- revealed_seed cannot exist without path_points_hash (i.e. the old
-- VRF rows stay valid), but path_points_hash on its own is now
-- accepted.

ALTER TABLE touch_bets DROP CONSTRAINT IF EXISTS vrf_reveal_consistency;

ALTER TABLE touch_bets
    ADD CONSTRAINT vrf_reveal_consistency CHECK (
        revealed_seed IS NULL OR path_points_hash IS NOT NULL
    );
