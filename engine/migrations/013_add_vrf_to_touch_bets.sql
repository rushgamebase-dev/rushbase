-- Migration: VRF commit/reveal columns on touch_bets.
--
-- Replaces the Binance-feed resolver with a provably-fair scheme:
-- at placement, the engine generates a 256-bit secret seed,
-- computes a keccak256 commit binding (seed, bet_id, user_wallet,
-- band, window), signs the commit with the engine signer
-- (EIP-191), and persists the seed encrypted at rest. The client
-- receives only the commit hash + signature.
--
-- After window_end_ms, the resolver decrypts the seed, regenerates
-- the path deterministically, and records the result. The reveal is
-- broadcast on `BetResolved` and re-served from the
-- /trade/bets/:id/verify endpoint so the client can:
--   1. recompute the commit hash and confirm it matches what was
--      signed at placement;
--   2. recover the engine signer's address from the signature and
--      check it equals `engineSigner` on the vault contract;
--   3. regenerate the path from the seed and confirm
--      `path_points_hash` matches the engine's record.
--
-- Columns are nullable for backwards-compat with any in-flight
-- legacy (Binance-resolved) bets, but all new bets created by the
-- VRF engine MUST populate the commit columns. The CHECK
-- constraints enforce that the commit triple
-- (seed_encrypted, commit_hash, commit_signature) is set together,
-- and the reveal pair (revealed_seed, path_points_hash) is set
-- together once.

ALTER TABLE touch_bets
    -- AES-256-GCM ciphertext: 12-byte nonce || ciphertext_with_16-byte_tag.
    -- Plaintext is the 32-byte seed, so ciphertext is 12 + 32 + 16 = 60 bytes.
    -- Allow up to 256 to leave room for future scheme changes.
    ADD COLUMN seed_encrypted BYTEA,
    -- keccak256(domain_tag || seed || bet_id || user_wallet || p_min || p_max
    --          || window_start || window_end). 32 bytes.
    ADD COLUMN commit_hash BYTEA,
    -- (r, s, v) EIP-191 signature from the engine signer over the
    -- commit hash. 65 bytes. Verifies against the same EOA the user
    -- already trusts via the vault contract's `engineSigner`.
    ADD COLUMN commit_signature BYTEA,
    -- Snapshot of the path-config identifier at placement time
    -- (e.g. "vrf-path-v2"). The resolver refuses to settle a bet
    -- whose config version isn't compiled into the binary.
    ADD COLUMN path_config_version VARCHAR(32),
    -- Plaintext seed, populated AT REVEAL ONLY (post window_end_ms).
    -- Single source of truth for the verify endpoint and the WS
    -- BetResolved payload.
    ADD COLUMN revealed_seed BYTEA,
    -- SHA-256 hex of the path's JSON serialization. Lets the client
    -- regenerate the path from `revealed_seed` and confirm bit-equality.
    ADD COLUMN path_points_hash VARCHAR(64),
    -- Regime label sampled from the seed ("CALM", "CHOPPY",
    -- "MOMENTUM_UP", "MOMENTUM_DOWN", "SPIKE", "REVERSAL"). Useful
    -- for analytics dashboards and the verifier UI.
    ADD COLUMN path_regime VARCHAR(20);

-- Hot path for the resolver scan (ACTIVE bets past their window) is
-- already indexed via idx_touch_bets_active_window_end. No new index
-- needed for VRF columns themselves.

ALTER TABLE touch_bets
    -- The commit triple must be all-set or all-NULL (legacy bets).
    -- Once the VRF engine ships, every new INSERT goes through the
    -- all-set branch; legacy NULLs are read-only history.
    ADD CONSTRAINT vrf_commit_consistency CHECK (
        (seed_encrypted IS NULL AND commit_hash IS NULL AND commit_signature IS NULL
         AND path_config_version IS NULL)
        OR
        (seed_encrypted IS NOT NULL AND commit_hash IS NOT NULL
         AND commit_signature IS NOT NULL AND path_config_version IS NOT NULL)
    ),
    -- Reveal pair must coexist. UPDATE at resolution sets both
    -- atomically inside the same transaction that flips status.
    ADD CONSTRAINT vrf_reveal_consistency CHECK (
        (revealed_seed IS NULL AND path_points_hash IS NULL)
        OR
        (revealed_seed IS NOT NULL AND path_points_hash IS NOT NULL)
    ),
    -- Cryptographic sizes are immutable: 32-byte keccak digest,
    -- 65-byte (r, s, v) signature, 32-byte seed. Tiny safety net
    -- against a buggy migration writing the wrong width.
    ADD CONSTRAINT commit_hash_size CHECK (
        commit_hash IS NULL OR octet_length(commit_hash) = 32
    ),
    ADD CONSTRAINT commit_signature_size CHECK (
        commit_signature IS NULL OR octet_length(commit_signature) = 65
    ),
    ADD CONSTRAINT revealed_seed_size CHECK (
        revealed_seed IS NULL OR octet_length(revealed_seed) = 32
    ),
    -- Encrypted seed is ≥60 bytes (12 nonce + 32 plaintext + 16 tag)
    -- and ≤256 to bound a misconfigured row.
    ADD CONSTRAINT seed_encrypted_size CHECK (
        seed_encrypted IS NULL
        OR (octet_length(seed_encrypted) >= 60 AND octet_length(seed_encrypted) <= 256)
    ),
    -- path_points_hash is a 64-char hex string (SHA-256). Same
    -- rationale as the byte-length checks above.
    ADD CONSTRAINT path_points_hash_format CHECK (
        path_points_hash IS NULL OR path_points_hash ~ '^[0-9a-f]{64}$'
    );
