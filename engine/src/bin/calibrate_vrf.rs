//! Monte Carlo calibration for the VRF arena multiplier table.
//!
//! For each `(distance_bps, duration_ms)` cell in the catalog, this
//! binary runs N deterministic VRF paths and counts how often the
//! generated trajectory touches a band of fixed width
//! (`BAND_WIDTH_BPS`) sitting `distance_bps` above the start price.
//! The empirical hit rate is the realised `p_touch` for that cell.
//!
//! Output is a TOML snippet ready to paste into
//! `config/default.toml` under `[multiplier]`:
//!
//!   ```toml
//!   [[multiplier.empirical_cells]]
//!   distance_bps = 12
//!   duration_ms  = 9000
//!   p_touch      = 0.184
//!   ```
//!
//! Why this matters
//! ----------------
//! The previous `MultiplierConfig` was tuned with a single Bachelier
//! `vol_bps_per_sqrt_sec` parameter calibrated against Binance
//! microstructure. The VRF generator now drives all bet outcomes —
//! and it has six regimes (Calm, Choppy, Spike, Reversal, Momentum±)
//! whose impulse profile differs by 5×+ in Spike. A single-vol model
//! systematically under-prices wide-band / long-window cells in
//! Spike-heavy seed populations, leaking EV to the player.
//!
//! Run before any cap-tightening cycle:
//!
//!   ```bash
//!   cargo run --release --bin calibrate_vrf > /tmp/empirical.toml
//!   ```
//!
//! Paste the result into `config/default.toml`, bump
//! `empirical_safety_factor` to ≥ 2.0, and re-run cargo test to
//! confirm the EV+ guard rejects new cases that the table reveals.
//!
//! Determinism
//! -----------
//! Sample seeds are derived as
//! `"calibrate-vrf:{path_config_version}:{cell_id}:{sample_index}"`.
//! Re-running the binary on the same `PATH_CONFIG_VERSION` yields
//! byte-identical output. Bumping the path config version (after
//! tweaking the generator) invalidates all old samples — by design;
//! a new calibration MUST follow any path-shape change.

use rush_engine::vrf::{first_touch_ms, generate_vrf_path, VrfPathInput, PATH_CONFIG_VERSION};
use rayon::prelude::*;
use std::time::Instant;

/// Anchor price for the canonical Monte Carlo run. The probability
/// is scale-invariant for percentage-distance bands, so any positive
/// value works; we pick the same anchor the in-process Rush Index
/// uses so the tooling matches what the engine sees.
const START_PRICE: f64 = 1_245.73;

/// Band width for calibration. **Must match the UX grid** — the
/// frontend renders cells with `PRICE_STEP_BPS = 40` per row, so
/// the production cell is 40 bps tall. Calibrating with a thinner
/// band (e.g. 4 bps) under-estimates `p_touch` and lets the engine
/// quote multipliers as if the band were narrower than it is, which
/// is player-positive. The grid-row geometry is the source of truth
/// here; tweaking it requires a re-run of this binary.
const BAND_WIDTH_BPS: u32 = 40;

/// Path generator config — must mirror what `touch::engine` uses
/// at resolve time (and what the production VRF generator runs
/// with). Bumping any of these invalidates the calibration; bump
/// `PATH_CONFIG_VERSION` in tandem.
const TICK_MS: i64 = 100;
const VOLATILITY_BPS: f64 = 2.8;
const BOUND_BPS: f64 = 190.0;

/// Distances in bps from the start price to the band's near edge.
/// The UX renders rows at `0, 40, 80, 120, 160` bps from centre
/// (`PRICE_STEP_BPS = 40` × ⌊rows/2⌋), so cells the player sees
/// have `distance ∈ {40, 80, 120}` (rows beyond 160 cross the
/// `max_distance_bps = 180` cordon and are refused as TOO_RISKY).
///
/// We calibrate exactly those distances. Off-grid distances
/// (e.g. 25, 60) are not part of the production catalog; if a
/// future UX adds them, this table needs another row.
const DISTANCES_BPS: &[u32] = &[40, 80, 120];

/// Window durations in ms — must match `[touch] allowed_window_ms`
/// in `config/default.toml`. Cells outside this list are not
/// quotable; calibrating them would be dead weight in the table.
const DURATIONS_MS: &[u64] = &[3_000, 6_000, 9_000, 12_000, 18_000, 30_000, 60_000];

/// Samples per cell. 4096 is a balance between calibration time
/// (~1 min on 8 cores release) and standard error
/// (1/√4096 ≈ 1.6 % at p = 0.5, ≈ 0.5 % at p = 0.05). Bump if you
/// see wobble in successive runs.
const SAMPLES_PER_CELL: usize = 4_096;

fn main() {
    eprintln!(
        "Calibrating VRF arena multiplier table ({} distances × {} durations × {} samples = {} paths)…",
        DISTANCES_BPS.len(),
        DURATIONS_MS.len(),
        SAMPLES_PER_CELL,
        DISTANCES_BPS.len() * DURATIONS_MS.len() * SAMPLES_PER_CELL,
    );
    eprintln!("path_config_version = {}", PATH_CONFIG_VERSION);
    let started = Instant::now();

    // Each cell is independent → parallelise with rayon. Inside a
    // cell, samples are also independent but Monte Carlo over 4k
    // samples fits well in a single thread; parallelising at the
    // cell level keeps the per-task work uniform.
    let mut grid: Vec<(u32, u64, f64)> = DISTANCES_BPS
        .par_iter()
        .flat_map(|&d| {
            DURATIONS_MS
                .par_iter()
                .map(move |&dur| {
                    let p = monte_carlo_p_touch(d, dur);
                    (d, dur, p)
                })
        })
        .collect();
    grid.sort_by_key(|(d, dur, _)| (*d, *dur));

    let elapsed = started.elapsed();
    eprintln!("Done in {:.2}s.", elapsed.as_secs_f64());

    // ── stdout: TOML for default.toml ─────────────────────────
    println!("# === VRF arena empirical p_touch table ===");
    println!("# Generated by `cargo run --release --bin calibrate_vrf`");
    println!("# path_config_version = {}", PATH_CONFIG_VERSION);
    println!("# samples_per_cell    = {}", SAMPLES_PER_CELL);
    println!("# band_width_bps      = {}", BAND_WIDTH_BPS);
    println!("# tick_ms             = {}", TICK_MS);
    println!("# volatility_bps      = {}", VOLATILITY_BPS);
    println!("# bound_bps           = {}", BOUND_BPS);
    println!("#");
    println!("# Paste under [multiplier] and bump empirical_safety_factor to ≥ 2.0.");
    println!();
    for (d, dur, p) in &grid {
        println!("[[multiplier.empirical_cells]]");
        println!("distance_bps = {}", d);
        println!("duration_ms  = {}", dur);
        println!("p_touch      = {:.4}", p);
        println!();
    }

    // ── stderr: human-friendly grid ───────────────────────────
    eprintln!();
    eprintln!("Empirical p_touch grid (rows = distance_bps, cols = duration_ms):");
    eprint!("{:>8} |", "");
    for dur in DURATIONS_MS {
        eprint!(" {:>7}", dur);
    }
    eprintln!();
    eprintln!("{:->8}-+{:->1$}", "", DURATIONS_MS.len() * 8 + 1);
    for d in DISTANCES_BPS {
        eprint!("{:>8} |", d);
        for dur in DURATIONS_MS {
            let p = grid
                .iter()
                .find(|(dd, ddur, _)| dd == d && ddur == dur)
                .map(|(_, _, p)| *p)
                .unwrap_or(0.0);
            eprint!(" {:>7.4}", p);
        }
        eprintln!();
    }
}

fn monte_carlo_p_touch(distance_bps: u32, duration_ms: u64) -> f64 {
    let p_min = START_PRICE * (1.0 + distance_bps as f64 / 10_000.0);
    let p_max =
        START_PRICE * (1.0 + (distance_bps + BAND_WIDTH_BPS) as f64 / 10_000.0);

    let window_start_ms: i64 = 0;
    let window_end_ms: i64 = duration_ms as i64;

    // SAMPLES_PER_CELL Monte Carlo iterations, each independent.
    let hits: usize = (0..SAMPLES_PER_CELL)
        .into_par_iter()
        .filter(|i| {
            let seed = format!(
                "calibrate-vrf:{}:{}:{}:{}",
                PATH_CONFIG_VERSION, distance_bps, duration_ms, i
            );
            let path = generate_vrf_path(VrfPathInput {
                seed,
                start_price: START_PRICE,
                start_time_ms: 0,
                end_time_ms: window_end_ms,
                tick_ms: TICK_MS,
                volatility_bps: VOLATILITY_BPS,
                bound_bps: BOUND_BPS,
            });
            first_touch_ms(
                &path,
                p_min,
                p_max,
                window_start_ms,
                window_end_ms,
                window_end_ms,
            )
            .is_some()
        })
        .count();

    hits as f64 / SAMPLES_PER_CELL as f64
}
