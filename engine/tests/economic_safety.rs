//! Adversarial economic safety test.
//!
//! Simulates aggressive betting strategies against the calibrated
//! `MultiplierCalculator` and asserts the house finishes the run
//! with **positive** P&L. Runs in seconds (no Postgres, no Docker)
//! so it lives next to the integration tests as a fast canary.
//!
//! What it catches
//! ---------------
//! Calibration drift: if someone tweaks the path generator without
//! re-running `cargo run --release --bin calibrate_vrf`, the table
//! in `config/default.toml` no longer matches the realised
//! `p_touch`. With a 1.5× safety pad we tolerate up to 50 % drift
//! before any single cell turns player-positive — but even with
//! the pad, an attacker can concentrate on the worst-mispriced
//! cells and drain. The greedy strategies below pin those cells
//! and require the house to still come out ahead.
//!
//! Each strategy plays N=5_000 bets at 0.001 ETH stake (so the
//! sum is in milliETH and easy to read in the failure message).
//! 5_000 samples on cells with realistic p∈[0.05, 0.9] gives a
//! standard error of ≈ ±1 % on house EV — a real player-positive
//! cell would show up as a clearly negative house P&L.
//!
//! What it does NOT catch
//! ----------------------
//! - Cells outside the calibrated grid (Bachelier fallback). The
//!   `random_strategy` covers a few; for full coverage the runtime
//!   `quote-grid` should refuse off-grid cells, which is a separate
//!   change.
//! - Quote-shopping / coordinated wallets. That's a rate-limit
//!   concern, mitigated by per-wallet RL (P1 follow-up).
//! - Liquidity / solvency races. Caps in `RiskConfig` cover those.
//!
//! What it asserts
//! ---------------
//! For three strategies (random, greedy-max-multiplier,
//! greedy-min-distance), `house_pnl_wei > 0`.

use rush_engine::models::touch_bet::TouchDirection;
use rush_engine::touch::{MultiplierCalculator, MultiplierConfig};
use rush_engine::vrf::{
    first_touch_ms, generate_vrf_path, VrfPathInput, PATH_CONFIG_VERSION,
};
use std::collections::HashMap;

const START_PRICE: f64 = 1_245.73;
/// 0.001 ETH per bet — small enough that 5_000 bets sum to ≪ 1 ETH
/// in either direction; large enough to read PnL clearly.
const STAKE_WEI: i128 = 1_000_000_000_000_000;
const N_BETS: usize = 5_000;
/// Must match `BAND_WIDTH_BPS` in `bin/calibrate_vrf` and the UX
/// `PRICE_STEP_BPS`. Calibration, simulation, and runtime grid all
/// share this number.
const BAND_WIDTH_BPS: u32 = 40;

/// Snapshot of `[multiplier.empirical_cells]` from
/// `config/default.toml`. Update whenever the config table is
/// refreshed (after running `bin/calibrate_vrf`).
///
/// **Geometry**: bands are 40 bps wide (= UX `PRICE_STEP_BPS`),
/// distances are the rows the UX renders (40/80/120 bps), and the
/// offset axis covers the first five columns of the grid
/// (col 1 → offset 0, col N → offset (N-1) × COLUMN_MS).
///
/// Cells outside this 3D box fall back to Bachelier in the engine
/// and are refused with `disabled_reason = "UNCALIBRATED"`.
///
/// Tuple is `((distance_bps, duration_ms, offset_ms), p_touch)`.
const CALIBRATED_CELLS: &[((u32, u64, u64), f64)] = &[
    // offset = 0
    ((40, 3000, 0), 0.4436), ((40, 6000, 0), 0.6907),
    ((40, 9000, 0), 0.7729), ((40, 12000, 0), 0.7954),
    ((40, 18000, 0), 0.9019), ((40, 30000, 0), 0.9636),
    ((40, 60000, 0), 0.9966),
    ((80, 3000, 0), 0.0669), ((80, 6000, 0), 0.1772),
    ((80, 9000, 0), 0.1904), ((80, 12000, 0), 0.2017),
    ((80, 18000, 0), 0.2974), ((80, 30000, 0), 0.4119),
    ((80, 60000, 0), 0.6140),
    ((120, 3000, 0), 0.0032), ((120, 6000, 0), 0.0117),
    ((120, 9000, 0), 0.0137), ((120, 12000, 0), 0.0161),
    ((120, 18000, 0), 0.0269), ((120, 30000, 0), 0.0344),
    ((120, 60000, 0), 0.0642),
    // offset = 3000
    ((40, 3000, 3000), 0.5955), ((40, 6000, 3000), 0.6990),
    ((40, 9000, 3000), 0.7217), ((40, 12000, 3000), 0.8293),
    ((40, 18000, 3000), 0.9065), ((40, 30000, 3000), 0.9602),
    ((40, 60000, 3000), 0.9961),
    ((80, 3000, 3000), 0.1519), ((80, 6000, 3000), 0.1721),
    ((80, 9000, 3000), 0.1621), ((80, 12000, 3000), 0.2266),
    ((80, 18000, 3000), 0.3215), ((80, 30000, 3000), 0.4399),
    ((80, 60000, 3000), 0.6111),
    ((120, 3000, 3000), 0.0132), ((120, 6000, 3000), 0.0129),
    ((120, 9000, 3000), 0.0129), ((120, 12000, 3000), 0.0117),
    ((120, 18000, 3000), 0.0239), ((120, 30000, 3000), 0.0393),
    ((120, 60000, 3000), 0.0684),
    // offset = 6000
    ((40, 3000, 6000), 0.3503), ((40, 6000, 6000), 0.4194),
    ((40, 9000, 6000), 0.6482), ((40, 12000, 6000), 0.7861),
    ((40, 18000, 6000), 0.8718), ((40, 30000, 6000), 0.9624),
    ((40, 60000, 6000), 0.9971),
    ((80, 3000, 6000), 0.0400), ((80, 6000, 6000), 0.0457),
    ((80, 9000, 6000), 0.1096), ((80, 12000, 6000), 0.1838),
    ((80, 18000, 6000), 0.2622), ((80, 30000, 6000), 0.3838),
    ((80, 60000, 6000), 0.5918),
    ((120, 3000, 6000), 0.0010), ((120, 6000, 6000), 0.0022),
    ((120, 9000, 6000), 0.0059), ((120, 12000, 6000), 0.0134),
    ((120, 18000, 6000), 0.0151), ((120, 30000, 6000), 0.0310),
    ((120, 60000, 6000), 0.0601),
    // offset = 9000
    ((40, 3000, 9000), 0.1599), ((40, 6000, 9000), 0.4866),
    ((40, 9000, 9000), 0.6929), ((40, 12000, 9000), 0.8037),
    ((40, 18000, 9000), 0.8752), ((40, 30000, 9000), 0.9597),
    ((40, 60000, 9000), 0.9956),
    ((80, 3000, 9000), 0.0095), ((80, 6000, 9000), 0.0750),
    ((80, 9000, 9000), 0.1580), ((80, 12000, 9000), 0.2139),
    ((80, 18000, 9000), 0.2654), ((80, 30000, 9000), 0.4026),
    ((80, 60000, 9000), 0.6021),
    ((120, 3000, 9000), 0.0000), ((120, 6000, 9000), 0.0042),
    ((120, 9000, 9000), 0.0081), ((120, 12000, 9000), 0.0156),
    ((120, 18000, 9000), 0.0181), ((120, 30000, 9000), 0.0339),
    ((120, 60000, 9000), 0.0559),
    // offset = 12000
    ((40, 3000, 12000), 0.4282), ((40, 6000, 12000), 0.6614),
    ((40, 9000, 12000), 0.7646), ((40, 12000, 12000), 0.8066),
    ((40, 18000, 12000), 0.8921), ((40, 30000, 12000), 0.9619),
    ((40, 60000, 12000), 0.9971),
    ((80, 3000, 12000), 0.0691), ((80, 6000, 12000), 0.1528),
    ((80, 9000, 12000), 0.1904), ((80, 12000, 12000), 0.2178),
    ((80, 18000, 12000), 0.2932), ((80, 30000, 12000), 0.4048),
    ((80, 60000, 12000), 0.6182),
    ((120, 3000, 12000), 0.0029), ((120, 6000, 12000), 0.0107),
    ((120, 9000, 12000), 0.0134), ((120, 12000, 12000), 0.0129),
    ((120, 18000, 12000), 0.0183), ((120, 30000, 12000), 0.0337),
    ((120, 60000, 12000), 0.0681),
];

fn build_calc() -> MultiplierCalculator {
    let table: HashMap<(u32, u64, u64), f64> =
        CALIBRATED_CELLS.iter().copied().collect();
    MultiplierCalculator::new(MultiplierConfig {
        house_edge_bps: 500,
        min_multiplier_bps: 11_000,
        max_multiplier_bps: 5_000_000,
        vol_bps_per_sqrt_sec: 2.8,
        empirical_p_touch_table: Some(table),
        empirical_safety_factor: 1.5,
    })
}

/// Simulate a single bet against the live VRF generator. Returns
/// the house P&L for that bet in wei (positive = house wins).
/// Returns `None` when the engine would refuse the cell (off-table
/// or EV+ trap) — the simulator must skip it just like
/// `commit_open` would.
fn simulate_bet(
    calc: &MultiplierCalculator,
    distance_bps: u32,
    duration_ms: u64,
    offset_ms: u64,
    seed_nonce: u64,
) -> Option<i128> {
    let entry_q8 = (START_PRICE * 1e8) as u128;
    let band_min = entry_q8 + (entry_q8 * distance_bps as u128) / 10_000;
    let band_max = entry_q8
        + (entry_q8 * (distance_bps + BAND_WIDTH_BPS) as u128) / 10_000;

    let q = calc.quote(
        entry_q8,
        band_min,
        band_max,
        TouchDirection::Up,
        offset_ms,
        duration_ms,
    );

    // Replicate the engine's gates. Cells that fail any of these
    // are refused at `commit_open`; the simulator must do the same
    // or it will count house P&L on bets that production would
    // never accept.
    let p_touch_implied = q.implied_p_touch_bps as f64 / 10_000.0;
    if !q.from_empirical {
        return None;
    }
    if calc.is_ev_positive_at_floor(p_touch_implied) {
        return None;
    }
    if q.distance_bps == 0 {
        return None;
    }

    // Generate a fresh VRF path with a deterministic but
    // non-overlapping seed nonce. Same generator config as
    // `touch::engine::resolve_bet`. The path runs from t=0 to
    // window_end so first-passage detection sees the whole pre-
    // window evolution, mirroring real placement.
    let p_min = (band_min as f64) / 1e8;
    let p_max = (band_max as f64) / 1e8;
    let window_start = offset_ms as i64;
    let window_end = (offset_ms + duration_ms) as i64;
    let path = generate_vrf_path(VrfPathInput {
        seed: format!(
            "soak:{}:{}:{}:{}:{}",
            PATH_CONFIG_VERSION, distance_bps, duration_ms, offset_ms, seed_nonce
        ),
        start_price: START_PRICE,
        start_time_ms: 0,
        end_time_ms: window_end,
        tick_ms: 100,
        volatility_bps: 2.8,
        bound_bps: 190.0,
    });
    let won = first_touch_ms(
        &path,
        p_min,
        p_max,
        window_start,
        window_end,
        window_end,
    )
    .is_some();

    let payout_wei =
        STAKE_WEI.saturating_mul(q.multiplier_bps as i128) / 10_000;
    Some(if won {
        -(payout_wei - STAKE_WEI)
    } else {
        STAKE_WEI
    })
}

fn run_strategy(
    calc: &MultiplierCalculator,
    pick: impl Fn(usize) -> (u32, u64, u64),
) -> (i128, usize, usize) {
    let mut house_pnl: i128 = 0;
    let mut accepted: usize = 0;
    let mut rejected: usize = 0;
    for i in 0..N_BETS {
        let (d, dur, off) = pick(i);
        match simulate_bet(calc, d, dur, off, i as u64) {
            Some(pnl) => {
                house_pnl += pnl;
                accepted += 1;
            }
            None => rejected += 1,
        }
    }
    (house_pnl, accepted, rejected)
}

#[test]
fn random_strategy_keeps_house_positive() {
    // Sample uniformly across the entire calibrated 3D grid (the
    // production catalog: 3 distances × 7 durations × 5 offsets).
    // Picks deterministic by index. The engine's EV+ guard refuses
    // the cells where p_touch is too high to cover the floor
    // multiplier; the rest must be house-positive in expectation.
    let calc = build_calc();
    let pool: Vec<(u32, u64, u64)> = CALIBRATED_CELLS
        .iter()
        .map(|((d, dur, off), _)| (*d, *dur, *off))
        .collect();
    let pool_len = pool.len();
    let (pnl, accepted, rejected) =
        run_strategy(&calc, |i| pool[i % pool_len]);
    eprintln!(
        "[random] house_pnl_wei={pnl} accepted={accepted} rejected={rejected} \
         (over {N_BETS} picks)"
    );
    assert!(
        pnl > 0,
        "random strategy must lose money in expectation; got house_pnl={pnl}"
    );
}

#[test]
fn greedy_max_multiplier_keeps_house_positive() {
    // Player picks the cell with the highest acceptable multiplier
    // across the whole 3D grid — i.e. the single riskiest accepted
    // cell. Repeats it N_BETS times.
    let calc = build_calc();
    let entry_q8 = (START_PRICE * 1e8) as u128;
    let mut by_mult: Vec<((u32, u64, u64), u32)> = CALIBRATED_CELLS
        .iter()
        .filter_map(|((d, dur, off), _)| {
            let band_min = entry_q8 + (entry_q8 * *d as u128) / 10_000;
            let band_max = entry_q8
                + (entry_q8 * (d + BAND_WIDTH_BPS) as u128) / 10_000;
            let q = calc.quote(
                entry_q8,
                band_min,
                band_max,
                TouchDirection::Up,
                *off,
                *dur,
            );
            let p_touch = q.implied_p_touch_bps as f64 / 10_000.0;
            if calc.is_ev_positive_at_floor(p_touch) || q.distance_bps == 0 {
                None
            } else {
                Some(((*d, *dur, *off), q.multiplier_bps))
            }
        })
        .collect();
    by_mult.sort_by_key(|(_, m)| std::cmp::Reverse(*m));
    let top_cell = by_mult.first().expect("at least one acceptable cell").0;
    eprintln!("[greedy_max_mult] picked cell={top_cell:?}, mult_bps={}",
        by_mult[0].1);
    let (pnl, accepted, rejected) =
        run_strategy(&calc, move |_| top_cell);
    eprintln!(
        "[greedy_max_mult] house_pnl_wei={pnl} accepted={accepted} rejected={rejected}"
    );
    assert!(
        pnl > 0,
        "greedy-max-multiplier must lose money in expectation; \
         got house_pnl={pnl}, cell={top_cell:?}"
    );
}

#[test]
fn greedy_min_distance_keeps_house_positive() {
    // Closest cell that survives the EV+ guard at offset=0. Cell
    // (40, 3000, 0) has p≈0.44, under the 0.576 EV+ line at
    // safety=1.5. Row-1 col-1 of the UX grid.
    let calc = build_calc();
    let cell = (40_u32, 3_000_u64, 0_u64);
    let (pnl, accepted, rejected) = run_strategy(&calc, move |_| cell);
    eprintln!(
        "[greedy_min_dist] cell={cell:?} house_pnl_wei={pnl} \
         accepted={accepted} rejected={rejected}"
    );
    assert!(
        accepted > 0,
        "test setup error: chosen cell must be acceptable, but engine \
         rejected all {N_BETS} attempts. Pick a cell with p ≤ 0.576."
    );
    assert!(
        pnl > 0,
        "greedy-min-distance must lose money in expectation; \
         got house_pnl={pnl}, cell={cell:?}"
    );
}

#[test]
fn greedy_long_window_keeps_house_positive() {
    // Longest accepted window at offset=0. Cell (80, 30000, 0) has
    // p≈0.41, so the safety pad puts the target close to but under
    // the EV+ trap line. Long windows are where calibration error
    // compounds — if drift turns this player-positive it shows
    // here first.
    let calc = build_calc();
    let cell = (80_u32, 30_000_u64, 0_u64);
    let (pnl, accepted, rejected) = run_strategy(&calc, move |_| cell);
    eprintln!(
        "[greedy_long_window] cell={cell:?} house_pnl_wei={pnl} \
         accepted={accepted} rejected={rejected}"
    );
    assert!(
        accepted > 0,
        "test setup error: chosen cell must be acceptable, but engine \
         rejected all {N_BETS} attempts. Pick a cell with p ≤ 0.576."
    );
    assert!(
        pnl > 0,
        "greedy-long-window must lose money in expectation; \
         got house_pnl={pnl}, cell={cell:?}"
    );
}

#[test]
fn off_table_cells_are_refused() {
    // Geometry not present in the 3D calibration grid MUST be
    // refused. Bachelier fallback under-prices wide bands against
    // the VRF generator and lets a player drain the vault.
    //
    // The calibrated grid is `distances ∈ {20,40,…,200}` ×
    // `durations ∈ {3,6,9,12,18,30,60} s` × `offsets ∈ {0,1.5,…,12} s`,
    // with lookup tolerances DIST_TOL_BPS=20 / OFFSET_TOL_MS=750.
    // Anything outside those windows must miss the empirical table.
    let calc = build_calc();
    let entry_q8 = (START_PRICE * 1e8) as u128;

    // 1) Off-grid duration: 7500 ms is not in DURATIONS_MS, and the
    // lookup requires an exact duration match (no tolerance on the
    // duration axis).
    let band_min = entry_q8 + (entry_q8 * 80u128) / 10_000;
    let band_max = entry_q8 + (entry_q8 * 120u128) / 10_000;
    let q = calc.quote(
        entry_q8,
        band_min,
        band_max,
        TouchDirection::Up,
        0,
        7_500, // not in DURATIONS_MS
    );
    assert!(
        !q.from_empirical,
        "off-grid duration must NOT match empirical table"
    );

    // 2) Calibrated distance + duration but offset way past the
    // max calibrated (15000 ms vs 12000 ms cap, diff 3000 ms > 750 ms
    // tolerance). Falls outside the 3D grid.
    let band_min_40 = entry_q8 + (entry_q8 * 40u128) / 10_000;
    let band_max_40 = entry_q8 + (entry_q8 * 80u128) / 10_000;
    let q = calc.quote(
        entry_q8,
        band_min_40,
        band_max_40,
        TouchDirection::Up,
        15_000, // beyond OFFSETS_MS + tolerance
        3_000,
    );
    assert!(
        !q.from_empirical,
        "offset > calibrated max must fall back to Bachelier"
    );

    // 3) Calibrated cell at every catalogued offset — accepted.
    for offset in [0u64, 3_000, 6_000, 9_000, 12_000] {
        let q = calc.quote(
            entry_q8,
            band_min_40,
            band_max_40,
            TouchDirection::Up,
            offset,
            3_000,
        );
        assert!(
            q.from_empirical,
            "calibrated cell at offset={offset} must use empirical lookup"
        );
    }
}

#[test]
fn dangerous_cells_are_always_refused_by_ev_guard() {
    // The flip side of the cap suite above: cells with high p_touch
    // — long windows on tight bands — MUST be refused. If the EV+
    // guard ever lets one slip, the player can wallet-spam it for
    // free EV. This test pins the line on the UX grid (band=40 bps).
    let calc = build_calc();
    // Each of these has p>0.6 even after safety_factor=1.5 cap →
    // safety_p clamps to ~1.0 → mult clamped at min_floor 1.1× →
    // p × min_mult > 1.0 → EV+ trap → must reject.
    let dangerous = [
        (40_u32, 18_000_u64, 0_u64),   // p=0.90
        (40, 30_000, 0),               // p=0.96
        (40, 60_000, 0),               // p=1.00
        (80, 60_000, 0),               // p=0.61
        (40, 60_000, 3_000),           // p=1.00 at col 2
        (40, 30_000, 12_000),          // p=0.96 at col 5
    ];
    for cell in dangerous {
        let result = simulate_bet(&calc, cell.0, cell.1, cell.2, 0);
        assert!(
            result.is_none(),
            "EV+ guard MUST refuse {:?} but engine accepted it",
            cell
        );
    }
}
