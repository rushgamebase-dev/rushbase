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
/// `config/default.toml`. Update this constant whenever the config
/// table is refreshed (after running `bin/calibrate_vrf`).
///
/// **Geometry**: bands are 40 bps wide (= UX `PRICE_STEP_BPS`),
/// distances are the rows the UX renders (40/80/120 bps). Cells
/// outside this set fall back to Bachelier in the engine — those
/// are NOT safe to quote and must be rejected by the
/// `quote-grid` handler with `disabled_reason = "UNCALIBRATED"`.
const CALIBRATED_CELLS: &[((u32, u64), f64)] = &[
    ((40, 3000), 0.4495),
    ((40, 6000), 0.6990),
    ((40, 9000), 0.7573),
    ((40, 12000), 0.7856),
    ((40, 18000), 0.8992),
    ((40, 30000), 0.9658),
    ((40, 60000), 0.9968),
    ((80, 3000), 0.0667),
    ((80, 6000), 0.1687),
    ((80, 9000), 0.1816),
    ((80, 12000), 0.1929),
    ((80, 18000), 0.3059),
    ((80, 30000), 0.4114),
    ((80, 60000), 0.6143),
    ((120, 3000), 0.0024),
    ((120, 6000), 0.0120),
    ((120, 9000), 0.0149),
    ((120, 12000), 0.0095),
    ((120, 18000), 0.0239),
    ((120, 30000), 0.0320),
    ((120, 60000), 0.0676),
];

fn build_calc() -> MultiplierCalculator {
    let table: HashMap<(u32, u64), f64> = CALIBRATED_CELLS.iter().copied().collect();
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
/// Returns `None` when the engine would refuse the cell (EV+ trap)
/// — the simulator must skip it, just like `commit_open` would.
fn simulate_bet(
    calc: &MultiplierCalculator,
    distance_bps: u32,
    duration_ms: u64,
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
        0,
        duration_ms,
    );

    // Replicate the engine's gates. Cells that fail any of these
    // are refused at `commit_open`; the simulator must do the same
    // or it will count house P&L on bets that production would
    // never accept.
    let p_touch_implied = q.implied_p_touch_bps as f64 / 10_000.0;
    if !q.from_empirical {
        // Off-table → engine refuses with InvalidBand("Cell not in
        // calibrated table"). Bachelier fallback is unsafe.
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
    // `touch::engine::resolve_bet`.
    let p_min = (band_min as f64) / 1e8;
    let p_max = (band_max as f64) / 1e8;
    let path = generate_vrf_path(VrfPathInput {
        seed: format!(
            "soak:{}:{}:{}:{}",
            PATH_CONFIG_VERSION, distance_bps, duration_ms, seed_nonce
        ),
        start_price: START_PRICE,
        start_time_ms: 0,
        end_time_ms: duration_ms as i64,
        tick_ms: 100,
        volatility_bps: 2.8,
        bound_bps: 190.0,
    });
    let won = first_touch_ms(
        &path,
        p_min,
        p_max,
        0,
        duration_ms as i64,
        duration_ms as i64,
    )
    .is_some();

    let payout_wei =
        STAKE_WEI.saturating_mul(q.multiplier_bps as i128) / 10_000;
    Some(if won {
        // House loses the (payout - stake) excess; stake itself is
        // already locked from the user, so net house cash flow is
        // `-(payout - stake)`.
        -(payout_wei - STAKE_WEI)
    } else {
        // House keeps the stake.
        STAKE_WEI
    })
}

fn run_strategy(
    calc: &MultiplierCalculator,
    pick: impl Fn(usize) -> (u32, u64),
) -> (i128, usize, usize) {
    let mut house_pnl: i128 = 0;
    let mut accepted: usize = 0;
    let mut rejected: usize = 0;
    for i in 0..N_BETS {
        let (d, dur) = pick(i);
        match simulate_bet(calc, d, dur, i as u64) {
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
    // Sample uniformly across the entire calibrated grid (the
    // production catalog). Picks deterministic by index. The
    // engine's EV+ guard refuses the cells where p_touch is too
    // high to cover the floor multiplier; the rest must be
    // house-positive in expectation.
    let calc = build_calc();
    let pool: Vec<(u32, u64)> = CALIBRATED_CELLS
        .iter()
        .map(|((d, dur), _)| (*d, *dur))
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
    // — i.e. the riskiest accepted cell. Repeats it 5 000 times.
    let calc = build_calc();
    let entry_q8 = (START_PRICE * 1e8) as u128;
    let mut by_mult: Vec<((u32, u64), u32)> = CALIBRATED_CELLS
        .iter()
        .filter_map(|((d, dur), _)| {
            let band_min = entry_q8 + (entry_q8 * *d as u128) / 10_000;
            let band_max = entry_q8
                + (entry_q8 * (d + BAND_WIDTH_BPS) as u128) / 10_000;
            let q = calc.quote(
                entry_q8,
                band_min,
                band_max,
                TouchDirection::Up,
                0,
                *dur,
            );
            let p_touch = q.implied_p_touch_bps as f64 / 10_000.0;
            if calc.is_ev_positive_at_floor(p_touch) || q.distance_bps == 0 {
                None
            } else {
                Some(((*d, *dur), q.multiplier_bps))
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
    // Closest cell that survives the EV+ guard. Cell (40, 3000) has
    // p≈0.45 — under the 0.576 EV+ line at safety=1.5, so accepted.
    // This is the row-1 cell on the UX grid: the closest the player
    // can ever click.
    let calc = build_calc();
    let cell = (40_u32, 3_000_u64);
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
    // Longest accepted window. Cell (80, 30000) has p≈0.41, so the
    // safety pad puts the target close to but under the EV+ trap
    // line. Long windows are where calibration error compounds —
    // if drift turns this player-positive we'll see it here first.
    let calc = build_calc();
    let cell = (80_u32, 30_000_u64);
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
    // Geometry not present in the calibration grid (e.g. distance=60,
    // band=40 bps, or any offset > 0) MUST be refused. Bachelier
    // fallback under-prices these against the VRF generator and
    // lets a player drain the vault.
    let calc = build_calc();
    let entry_q8 = (START_PRICE * 1e8) as u128;

    // 1) Off-grid distance: 60 bps falls between calibrated 40 and 80.
    let band_min = entry_q8 + (entry_q8 * 60u128) / 10_000;
    let band_max = entry_q8 + (entry_q8 * 100u128) / 10_000;
    let q = calc.quote(
        entry_q8,
        band_min,
        band_max,
        TouchDirection::Up,
        0,
        3_000,
    );
    assert!(
        !q.from_empirical,
        "off-grid distance must NOT match empirical table"
    );

    // 2) Calibrated distance but with offset > 0 (column 2+ of
    // the UX grid). Empirical lookup only fires at offset=0; the
    // engine must refuse anything else until calibration covers
    // the offset axis.
    let band_min_40 = entry_q8 + (entry_q8 * 40u128) / 10_000;
    let band_max_40 = entry_q8 + (entry_q8 * 80u128) / 10_000;
    let q = calc.quote(
        entry_q8,
        band_min_40,
        band_max_40,
        TouchDirection::Up,
        3_000, // future column → offset > 0
        3_000,
    );
    assert!(
        !q.from_empirical,
        "offset > 0 must fall back to Bachelier (= refused at engine)"
    );

    // 3) Calibrated distance & offset=0 — accepted.
    let q = calc.quote(
        entry_q8,
        band_min_40,
        band_max_40,
        TouchDirection::Up,
        0,
        3_000,
    );
    assert!(
        q.from_empirical,
        "calibrated cell at offset=0 must use empirical lookup"
    );
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
        (40_u32, 18_000_u64),  // p=0.90
        (40, 30_000),          // p=0.97
        (40, 60_000),          // p=1.00
        (80, 60_000),          // p=0.61
    ];
    for cell in dangerous {
        let result = simulate_bet(&calc, cell.0, cell.1, 0);
        assert!(
            result.is_none(),
            "EV+ guard MUST refuse {:?} but engine accepted it",
            cell
        );
    }
}
