use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct QuoteRequest {
    /// `BTCUSDT` or `ETHUSDT` (case-insensitive).
    #[schema(example = "BTCUSDT")]
    pub symbol: String,
    /// `"UP"` (band above entry) or `"DOWN"` (band below).
    #[schema(example = "UP")]
    pub direction: String,
    /// Lower edge of the price band, encoded as `price * 1e8` (q8) in
    /// decimal-string form. Engine treats wei-style numbers as strings
    /// to avoid float precision loss.
    #[schema(example = "5010000000000")]
    pub target_row_min_q8: String,
    #[schema(example = "5020000000000")]
    pub target_row_max_q8: String,
    /// Window length in milliseconds. Must match an entry of `allowed_window_ms`.
    #[schema(example = 3000)]
    pub window_duration_ms: u64,
    /// Offset (ms) between `now` and the start of the window. 0 ⇒ window
    /// opens immediately (col 1 of the grid). Col `N` ⇒ `(N-1) * duration`.
    /// First-passage pricing makes the multiplier specific to *this*
    /// interval — same band/duration with a different offset yields a
    /// different mult.
    #[serde(default)]
    #[schema(default = 0, example = 0)]
    pub window_start_offset_ms: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct QuoteResponse {
    pub symbol: String,
    pub direction: String,
    pub entry_price_q8: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_duration_ms: u64,
    /// Offset between server's `now` (at quote time) and the window
    /// start, in ms. Echoed so the client can verify that its cell
    /// matches the quote it was priced under.
    pub window_start_offset_ms: u64,
    pub distance_bps: u32,
    pub implied_p_touch_bps: u32,
    pub multiplier_bps: u32,
    pub server_time_ms: i64,
    /// `true` when the quoted p_touch came from the empirical lookup
    /// table; `false` for Bachelier fallback. Surfaced so the UI can
    /// disclose the data source per cell.
    pub from_empirical: bool,
    /// HMAC-signed token committing the engine to this quote for `quote_ttl_ms`.
    /// Clients echo it back on `/trade/bets`.
    pub quote_token: String,
    pub quote_expires_at_ms: i64,
}

/// Snapshot of the multiplier-pricing parameters the engine is
/// currently running with, including the empirical (distance × duration)
/// lookup table. Frontends fetch this once on mount and replicate
/// `multiplierFor` locally so per-cell labels match `/trade/quote`
/// exactly. Refresh whenever the calibration is rotated server-side.
#[derive(Debug, Serialize, ToSchema)]
pub struct MultiplierConfigResponse {
    pub house_edge_bps: u32,
    pub min_multiplier_bps: u32,
    pub max_multiplier_bps: u32,
    pub vol_bps_per_sqrt_sec: f64,
    pub empirical_safety_factor: f64,
    pub empirical_cells: Vec<EmpiricalCellDto>,
    /// Minimum distance in bps a band's near edge must sit from the
    /// current price. Quotes for distances below this are rejected
    /// server-side (see `TouchConfig::min_distance_bps`); clients
    /// should grey out / disable cells under this threshold so the
    /// user never tries to place an unplaceable bet.
    pub min_distance_bps: u32,
    pub max_distance_bps: u32,
    /// Window durations (ms) the engine accepts. Frontends use this
    /// to populate a duration selector — bets with a duration not in
    /// this list are rejected.
    pub allowed_window_ms: Vec<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EmpiricalCellDto {
    pub distance_bps: u32,
    pub duration_ms: u64,
    /// Future-column offset in ms (col 1 = 0, col N = (N-1) × duration).
    /// The empirical lookup is keyed on this triple, so the same
    /// distance/duration appears once per offset the calibrator swept.
    pub window_start_offset_ms: u64,
    pub p_touch: f64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenBetRequest {
    pub symbol: String,
    pub direction: String,
    pub stake_wei: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    /// What the client thinks the multiplier is. Server requires exact match
    /// — clients must re-quote on mismatch.
    pub expected_multiplier_bps: u32,
    /// Server-signed token from the matching `/trade/quote` response.
    /// Required: open_bet without a fresh, unmodified token is rejected.
    pub quote_token: String,
}

/// Bet view returned by REST and WS. **Never includes secret material.**
///
/// Fields that *must not* be populated while a bet is ACTIVE are
/// modelled as `Option<String>`:
///
///   - `revealed_seed_hex`, `path_points_hash`, `path_regime`
///
/// Their `Some(_)` values are persisted only on settle (after
/// `window_end_ms`), so the `From<&TouchBet>` impl just propagates
/// what's in the DB — there is no separate "is the window over?"
/// guard here. If the resolver hasn't run yet, those columns are
/// NULL and serialize as `null` to the client.
///
/// The encrypted seed (`seed_encrypted` on the row) is **never**
/// surfaced. There is no field for it on this struct, intentionally.
/// A test below pins the JSON shape so a future field rename can't
/// silently introduce a leak.
#[derive(Debug, Serialize, ToSchema)]
pub struct BetResponse {
    pub id: Uuid,
    pub symbol: String,
    pub direction: String,
    pub status: String,
    pub stake_wei: String,
    pub multiplier_bps: i32,
    pub potential_payout_wei: String,
    pub house_edge_wei: String,
    pub entry_price_q8: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub placed_at: i64,
    pub resolved_at: Option<i64>,
    pub touched_at: Option<i64>,
    pub realized_pnl_wei: Option<String>,

    // ── VRF commit fields ── (always set on bets created by the
    // VRF engine; legacy bets persisted before the migration leave
    // these as None.)
    /// `keccak256(domain || seed || bet_id || wallet || band || window)`
    /// — 32-byte hex. The client recomputes this from the revealed
    /// seed + the public preimage and confirms it matches.
    pub commit_hash: Option<String>,
    /// 65-byte (r, s, v) EIP-191 signature from the engine signer
    /// over the commit hash. The client recovers the signer address
    /// and confirms it equals `engineSigner` from the vault contract.
    pub commit_signature: Option<String>,
    /// e.g. `"vrf-path-v2"`. Lets the client run the right path
    /// generator at verification time.
    pub path_config_version: Option<String>,
    /// e.g. `"CALM"`. Public regime label sampled from the seed —
    /// useful for analytics / UI tags. Leaks negligible information
    /// about path shape (1 of 6 buckets).
    pub path_regime: Option<String>,

    // ── VRF reveal fields ── (None while the bet is ACTIVE; set
    // exactly when the resolver settles the bet, after
    // `window_end_ms`.)
    /// 32-byte hex of the revealed seed. Never set before resolution.
    pub revealed_seed_hex: Option<String>,
    /// SHA-256 hex of the path's JSON serialization. Never set before
    /// resolution.
    pub path_points_hash: Option<String>,
}

impl From<&crate::models::touch_bet::TouchBet> for BetResponse {
    fn from(b: &crate::models::touch_bet::TouchBet) -> Self {
        Self {
            id: b.id,
            symbol: b.symbol.clone(),
            direction: b.direction.as_str().to_string(),
            status: b.status.as_str().to_string(),
            stake_wei: b.stake_wei.to_string(),
            multiplier_bps: b.multiplier_bps,
            potential_payout_wei: b.potential_payout_wei.to_string(),
            house_edge_wei: b.house_edge_wei.to_string(),
            entry_price_q8: b.entry_price_q8.to_string(),
            target_row_min_q8: b.target_row_min_q8.to_string(),
            target_row_max_q8: b.target_row_max_q8.to_string(),
            window_start_ms: b.window_start_ms,
            window_end_ms: b.window_end_ms,
            placed_at: b.placed_at.timestamp_millis(),
            resolved_at: b.resolved_at.map(|t| t.timestamp_millis()),
            touched_at: b.touched_at.map(|t| t.timestamp_millis()),
            realized_pnl_wei: b.realized_pnl_wei.as_ref().map(|x| x.to_string()),

            commit_hash: b.commit_hash.as_deref().map(hex::encode),
            commit_signature: b.commit_signature.as_deref().map(hex::encode),
            path_config_version: b.path_config_version.clone(),
            path_regime: b.path_regime.clone(),
            revealed_seed_hex: b.revealed_seed.as_deref().map(hex::encode),
            path_points_hash: b.path_points_hash.clone(),
        }
    }
}

#[cfg(test)]
mod bet_response_leak_tests {
    use super::BetResponse;
    use bigdecimal::BigDecimal;
    use chrono::Utc;
    use uuid::Uuid;

    /// Pin the serialized JSON shape: anyone adding a field that
    /// embeds the encrypted seed (or any other sensitive bytes) will
    /// trip this test. The forbidden substrings are the ones that
    /// could appear in a leaked payload — encrypted seed bytes hex-
    /// or base64-encoded, or anything that contains the key
    /// `seed_encrypted`.
    #[test]
    fn response_shape_does_not_leak_encrypted_seed() {
        let bet = crate::models::touch_bet::TouchBet {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            symbol: "RUSH_INDEX".into(),
            direction: crate::models::touch_bet::TouchDirection::Up,
            status: crate::models::touch_bet::TouchStatus::Active,
            stake_wei: BigDecimal::from(1u32),
            multiplier_bps: 12_000,
            potential_payout_wei: BigDecimal::from(2u32),
            house_edge_wei: BigDecimal::from(0u32),
            entry_price_q8: BigDecimal::from(50_000_00000000_i64),
            target_row_min_q8: BigDecimal::from(50_010_00000000_i64),
            target_row_max_q8: BigDecimal::from(50_050_00000000_i64),
            window_start_ms: 1_700_000_000_000,
            window_end_ms: 1_700_000_003_000,
            placed_at: Utc::now(),
            resolved_at: None,
            touched_at: None,
            realized_pnl_wei: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            // Sensitive: seed_encrypted populated as it would be in
            // production. The serialized response below MUST NOT
            // contain these bytes anywhere.
            seed_encrypted: Some(
                b"DO_NOT_LEAK_TOTALLY_SECRET_PAYLOAD".to_vec(),
            ),
            commit_hash: Some(vec![0xab; 32]),
            commit_signature: Some(vec![0xcd; 65]),
            path_config_version: Some("vrf-path-v2".into()),
            revealed_seed: None,
            path_points_hash: None,
            path_regime: Some("CALM".into()),
        };
        let resp = BetResponse::from(&bet);
        let json = serde_json::to_string(&resp).expect("serialize");
        assert!(
            !json.contains("seed_encrypted"),
            "BetResponse serialized field name 'seed_encrypted' — the response struct \
             must not surface this column. JSON: {json}"
        );
        assert!(
            !json.contains("DO_NOT_LEAK"),
            "BetResponse JSON contains the encrypted seed payload bytes. \
             JSON: {json}"
        );
        // Also: while ACTIVE, revealed_seed_hex and path_points_hash
        // must be null. Belt-and-braces against a future engineer
        // populating them out of band.
        assert!(
            json.contains("\"revealed_seed_hex\":null"),
            "ACTIVE bet must have revealed_seed_hex=null. JSON: {json}"
        );
        assert!(
            json.contains("\"path_points_hash\":null"),
            "ACTIVE bet must have path_points_hash=null. JSON: {json}"
        );
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BetListResponse {
    pub bets: Vec<BetResponse>,
    pub total: i64,
}

/// Anonymised bet row for the public social-proof panels
/// (`/trade/bets/public`, `/trade/wins/public`). Drops every sensitive
/// field — no user_id, no commit_hash, no seed_encrypted — and replaces
/// the wallet_address with a short handle the UI can display.
///
/// `player_handle` rules:
///   - if the user set a `username`, return it verbatim;
///   - else return `0xABCD…1234` (first 6 + last 4 chars of the wallet).
#[derive(Debug, Serialize, ToSchema)]
pub struct PublicBetEntry {
    pub id: Uuid,
    pub symbol: String,
    pub player_handle: String,
    pub stake_wei: String,
    pub multiplier_bps: u32,
    pub potential_payout_wei: String,
    pub placed_at_ms: i64,
    pub window_end_ms: i64,
    /// Resolution timestamp (ms). `null` while ACTIVE; populated for
    /// rows returned by `/trade/wins/public`.
    pub resolved_at_ms: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PublicBetListResponse {
    pub bets: Vec<PublicBetEntry>,
    pub total: i64,
}

impl From<&crate::db::repositories::touch_bet_repo::PublicBetRow> for PublicBetEntry {
    fn from(r: &crate::db::repositories::touch_bet_repo::PublicBetRow) -> Self {
        let player_handle = if r.username.is_empty() {
            short_wallet(&r.wallet_address)
        } else {
            r.username.clone()
        };
        Self {
            id: r.id,
            symbol: r.symbol.clone(),
            player_handle,
            stake_wei: r.stake_wei.to_string(),
            multiplier_bps: r.multiplier_bps as u32,
            potential_payout_wei: r.potential_payout_wei.to_string(),
            placed_at_ms: r.placed_at.timestamp_millis(),
            window_end_ms: r.window_end_ms,
            resolved_at_ms: r.resolved_at.map(|t| t.timestamp_millis()),
        }
    }
}

fn short_wallet(addr: &str) -> String {
    if addr.len() < 10 {
        return addr.to_string();
    }
    format!("{}…{}", &addr[..6], &addr[addr.len() - 4..])
}

/// One aggregated cell on the public heatmap. The canvas matches it
/// against its local cells by comparing the four absolute identifiers
/// (`target_row_*_q8`, `window_*_ms`) — these are stable across
/// players because they are absolute price levels and absolute world
/// time, not viewport-relative.
#[derive(Debug, Serialize, ToSchema)]
pub struct HeatmapCell {
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub n_bets: i64,
    pub total_stake_wei: String,
}

/// Heatmap response: how many distinct players are "in the room" right
/// now plus the per-cell bet density. Polled by the canvas every 2 s.
#[derive(Debug, Serialize, ToSchema)]
pub struct HeatmapResponse {
    pub online_count: i64,
    pub cells: Vec<HeatmapCell>,
}

impl From<&crate::db::repositories::touch_bet_repo::HeatmapCellRow> for HeatmapCell {
    fn from(r: &crate::db::repositories::touch_bet_repo::HeatmapCellRow) -> Self {
        Self {
            target_row_min_q8: r.target_row_min_q8.to_string(),
            target_row_max_q8: r.target_row_max_q8.to_string(),
            window_start_ms: r.window_start_ms,
            window_end_ms: r.window_end_ms,
            n_bets: r.n_bets,
            total_stake_wei: r.total_stake_wei.to_string(),
        }
    }
}

/// Bundle of everything a client needs to verify a settled bet
/// off-line. Returned by `GET /trade/bets/:id/verify` after
/// `window_end_ms`. Before the window has elapsed the endpoint
/// returns `425 Too Early` instead of a partial payload.
///
/// Verification recipe:
///
///   1. recompute `keccak256("rush.vrf.commit.v1" || revealed_seed
///      || bet_id || user_wallet || target_row_min_q8 ||
///      target_row_max_q8 || window_start_ms || window_end_ms)`
///      and confirm it equals `commit_hash`;
///
///   2. recover the signer address from `commit_signature` using
///      EIP-191 (`\x19Ethereum Signed Message:\n32 || commit_hash`)
///      and confirm it equals the address you read from the vault
///      contract's `engineSigner()`;
///
///   3. regenerate the path with the public algorithm tagged by
///      `path_config_version`, hash the resulting points the same
///      way the engine did, and confirm the hash equals
///      `path_points_hash`;
///
///   4. apply first-touch to the regenerated path with the same
///      band/window and confirm the boolean result equals the bet's
///      `WON` / `LOST` status.
#[derive(Debug, Serialize, ToSchema)]
pub struct BetVerificationResponse {
    pub bet_id: Uuid,
    pub status: String,
    pub user_wallet: String,
    pub commit_hash: String,
    pub commit_signature: String,
    /// Address the client should compare to the vault's
    /// `engineSigner()`. Convenience: the client doesn't have to
    /// recover it itself before the comparison; the recovery is
    /// re-checked client-side anyway as part of step 2.
    pub commit_signer_address: String,
    pub path_config_version: String,
    pub path_regime: Option<String>,
    pub revealed_seed_hex: String,
    pub path_points_hash: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub entry_price_q8: String,
    pub touched_at: Option<i64>,
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct BetHistoryQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Single cell descriptor inside a `quote-grid` request. The frontend
/// supplies the geometry it wants priced; the engine returns multiplier,
/// implied p_touch, max_stake_wei and a `disabled_reason` when the cell
/// can't be opened. No HMAC token is issued here — quote-grid is a
/// read-only price feed for live-rendering the catalog. To actually
/// place a bet the client still has to call `/trade/quote` for that
/// specific cell to obtain a signed token.
#[derive(Debug, Deserialize, ToSchema)]
pub struct QuoteGridCellRequest {
    /// Stable id chosen by the client (e.g. `r3c5`). Echoed back so the
    /// renderer can map the response onto its own pool without depending
    /// on array ordering.
    pub cell_id: String,
    pub direction: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_start_offset_ms: u64,
    pub window_duration_ms: u64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct QuoteGridRequest {
    pub symbol: String,
    pub cells: Vec<QuoteGridCellRequest>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct QuoteGridCellResponse {
    pub cell_id: String,
    pub distance_bps: u32,
    pub implied_p_touch_bps: u32,
    pub multiplier_bps: u32,
    /// Largest stake that fits inside `max_payout_per_bet_wei` at the
    /// quoted multiplier. Frontend should clamp the user's stake input
    /// at this value to avoid a 400 on open_bet.
    pub max_stake_wei: String,
    /// Set when the engine refuses to open a bet on this cell. Possible
    /// values: `EV_POSITIVE`, `TOO_EASY`, `TOO_RISKY`, `PRICE_STALE`,
    /// `PRICE_UNAVAILABLE`, `INVALID_BAND`, `INVALID_WINDOW`.
    pub disabled_reason: Option<String>,
    pub from_empirical: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct QuoteGridResponse {
    pub symbol: String,
    pub server_time_ms: i64,
    pub entry_price_q8: String,
    pub house_edge_bps: u32,
    /// Hard ceiling on potential payout per individual bet. Echoed so
    /// the frontend can display "max stake" hints even before any
    /// per-cell limit is applied.
    pub max_payout_per_bet_wei: String,
    pub cells: Vec<QuoteGridCellResponse>,
}
