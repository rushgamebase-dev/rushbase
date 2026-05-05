//! Calibrate the empirical p_touch table against the live
//! `arena_index` generator. Replaces `bin/calibrate_vrf` in the
//! single-line model where the visible cobra IS the resolver.
//!
//! Inputs (compile-time):
//!   - SAMPLES_PER_CELL       — Monte Carlo paths per (distance,
//!                              duration, offset) triple.
//!   - DISTANCE_BPS_LIST      — band-near-edge distances to sweep
//!                              (matches the canvas grid steps).
//!   - DURATION_MS_LIST       — bet windows the engine accepts
//!                              (mirror of [touch].allowed_window_ms).
//!   - OFFSET_MS_LIST         — column offsets the canvas exposes.
//!
//! The simulation copies `ArenaIndex::advance` byte-for-byte so the
//! calibration is faithful to what the live engine actually emits.
//! Each cell's p_touch is recorded with band width 40 bps centred on
//! `distance + 20` bps above the entry price (matches `priceStepBps`).
//!
//! Run:
//!   cd engine
//!   cargo run --release --bin calibrate_index > /tmp/empirical_cells.toml
//!
//! Then paste the body into `engine/config/default.toml` under
//! `[multiplier]` and regenerate the frontend bundle.
//!
//! Symmetry: only the UP direction is simulated. The advance dynamics
//! are symmetric around `INITIAL_PRICE` (mean reversion + elastic),
//! so DOWN bets reuse the same table.

use std::time::Instant;

const SAMPLES_PER_CELL: usize = 4_096;
const TICK_MS: i64 = 150;
const INITIAL_PRICE: f64 = 1_245.73;
const SOFT_BAND_BPS: f64 = 60.0;
const HARD_CAP_BPS: f64 = 150.0;
const BAND_WIDTH_BPS: f64 = 40.0;

// Warm-up before measurement starts. Without it every path starts at
// (price=anchor, vel=0) and the table reports the unconditional
// probability that *some* anchor-rooted path touches a band during
// [offset, offset+duration] — which over-counts touches that happen
// because the snake has had time to drift since t=0.
//
// Real play is different: the snake is already in motion at quote
// time, and the band is anchored to the snake's CURRENT position
// (engine measures `distance_bps = |band_edge - current_price| / current_price`).
// Warming up for 800 ticks (~120 s) lets the path reach steady state
// before we anchor the band at `path[WARMUP_TICKS]`, so the simulated
// p_touch matches what the resolver actually observes when the bet
// is placed.
const WARMUP_TICKS: usize = 800;

const DISTANCE_BPS_LIST: &[u32] = &[20, 40, 60, 80, 100, 120, 140, 160, 180, 200];
const DURATION_MS_LIST: &[u64] = &[3_000, 6_000, 9_000, 12_000, 18_000, 30_000, 60_000];
const OFFSET_MS_LIST: &[u64] = &[0, 1_500, 3_000, 4_500, 6_000, 7_500, 9_000, 10_500, 12_000];

fn xorshift32(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

fn uniform(state: &mut u32) -> f64 {
    let v = xorshift32(state);
    (v as f64 + 0.5) / (u32::MAX as f64 + 1.0)
}

fn normal_sample(state: &mut u32) -> f64 {
    let u = uniform(state).max(1e-9);
    let v = uniform(state).max(1e-9);
    (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
}

/// One arena_index step. Mirror of `ArenaIndex::advance` minus the
/// mutex, history, and clock — those are inessential for the
/// distribution we're sampling. Returns the new (price, velocity).
fn advance_one(price: f64, velocity: f64, tick: u64, rng: &mut u32) -> (f64, f64) {
    let deviation_bps = ((price - INITIAL_PRICE) / INITIAL_PRICE) * 10_000.0;
    let abs_dev = deviation_bps.abs();

    let cyclical = (tick as f64 / 19.0).sin() * 0.000_06
        + (tick as f64 / 61.0).sin() * 0.000_04;

    let base_reversion = -deviation_bps / 10_000.0 * 0.000_3;
    let overflow =
        ((abs_dev - SOFT_BAND_BPS).max(0.0) / (HARD_CAP_BPS - SOFT_BAND_BPS).max(1.0))
            .clamp(0.0, 1.0);
    let elastic = -deviation_bps.signum() * overflow * overflow * 0.001_8;

    let impulse =
        normal_sample(rng) * 0.000_26 + cyclical + base_reversion + elastic;

    let mut new_velocity = (velocity * 0.92 + impulse).clamp(-0.001_6, 0.001_6);
    let mut new_price = price * (1.0 + new_velocity);

    let cap_price = INITIAL_PRICE * HARD_CAP_BPS / 10_000.0;
    if new_price > INITIAL_PRICE + cap_price {
        new_price = INITIAL_PRICE + cap_price;
        new_velocity = -new_velocity.abs() * 0.5;
    } else if new_price < INITIAL_PRICE - cap_price {
        new_price = INITIAL_PRICE - cap_price;
        new_velocity = new_velocity.abs() * 0.5;
    }
    new_price = new_price.max(100.0);

    (new_price, new_velocity)
}

fn simulate_path(seed: u32, ticks: usize) -> Vec<f64> {
    let mut rng = seed.max(1);
    let mut price = INITIAL_PRICE;
    let mut velocity = 0.0f64;
    let mut out = Vec::with_capacity(ticks + 1);
    out.push(price);
    for tick in 1..=ticks {
        let (p, v) = advance_one(price, velocity, tick as u64, &mut rng);
        price = p;
        velocity = v;
        out.push(price);
    }
    out
}

fn main() {
    let max_offset_ms = *OFFSET_MS_LIST.iter().max().unwrap();
    let max_duration_ms = *DURATION_MS_LIST.iter().max().unwrap();
    let measurement_ms = max_offset_ms + max_duration_ms;
    let measurement_ticks = (measurement_ms as i64 / TICK_MS) as usize + 4; // pad
    let total_ticks = WARMUP_TICKS + measurement_ticks;

    eprintln!(
        "Calibrating arena_index — {} cells × {} samples, {} ticks each ({} warm-up + {} measurement)",
        DISTANCE_BPS_LIST.len() * DURATION_MS_LIST.len() * OFFSET_MS_LIST.len(),
        SAMPLES_PER_CELL,
        total_ticks,
        WARMUP_TICKS,
        measurement_ticks
    );

    let started = Instant::now();

    // Triple-keyed counter: [distance_idx][duration_idx][offset_idx] = hits
    let mut hits = vec![
        vec![
            vec![0u32; OFFSET_MS_LIST.len()];
            DURATION_MS_LIST.len()
        ];
        DISTANCE_BPS_LIST.len()
    ];

    // Each path generates one full trajectory; we score every cell
    // against the same path so the 4096 budget is shared across the
    // 630-cell grid.
    for sample_idx in 0..SAMPLES_PER_CELL {
        // Distinct seeds per sample. Spread them out so adjacent
        // samples don't share the warm-up region of the PRNG.
        let seed = (0x9E37_79B1u32).wrapping_mul((sample_idx as u32) + 1);
        let path = simulate_path(seed, total_ticks);
        // After WARMUP_TICKS the path has reached steady state — both
        // its position relative to anchor and its velocity match the
        // distribution the resolver sees at quote time. We anchor the
        // band at this "now" price so distances are measured against
        // the snake's actual position, not against `INITIAL_PRICE`.
        let entry = path[WARMUP_TICKS];

        for (di, &distance_bps) in DISTANCE_BPS_LIST.iter().enumerate() {
            // UP band centred at (distance + 20) bps above entry.
            let center_bps = distance_bps as f64 + BAND_WIDTH_BPS / 2.0;
            let p_min = entry * (1.0 + (center_bps - BAND_WIDTH_BPS / 2.0) / 10_000.0);
            let p_max = entry * (1.0 + (center_bps + BAND_WIDTH_BPS / 2.0) / 10_000.0);

            for (oi, &offset_ms) in OFFSET_MS_LIST.iter().enumerate() {
                let start_idx = WARMUP_TICKS + (offset_ms as i64 / TICK_MS) as usize;
                for (durj, &duration_ms) in DURATION_MS_LIST.iter().enumerate() {
                    let end_idx = WARMUP_TICKS
                        + ((offset_ms + duration_ms) as i64 / TICK_MS) as usize;
                    let stop = end_idx.min(path.len() - 1);
                    let mut touched = false;
                    for k in start_idx..=stop {
                        let p = path[k];
                        if p >= p_min && p <= p_max {
                            touched = true;
                            break;
                        }
                    }
                    if touched {
                        hits[di][durj][oi] += 1;
                    }
                }
            }
        }

        if (sample_idx + 1) % 512 == 0 {
            eprintln!(
                "  {}/{} paths ({:.1}s elapsed)",
                sample_idx + 1,
                SAMPLES_PER_CELL,
                started.elapsed().as_secs_f64()
            );
        }
    }

    // Emit TOML.
    println!("# === arena_index empirical p_touch table ===");
    println!("# Generated by `cargo run --release --bin calibrate_index`");
    println!("# generator           = arena_index ({} ticks)", TICK_MS);
    println!("# samples_per_cell    = {}", SAMPLES_PER_CELL);
    println!("# band_width_bps      = {}", BAND_WIDTH_BPS as i64);
    println!("# tick_ms             = {}", TICK_MS);
    println!("# soft_band_bps       = {}", SOFT_BAND_BPS as i64);
    println!("# hard_cap_bps        = {}", HARD_CAP_BPS as i64);
    println!("# initial_price       = {}", INITIAL_PRICE);
    println!("#");
    println!("# Paste under [multiplier]. Re-run after bumping ArenaIndex");
    println!("# constants (SOFT_BAND_BPS, HARD_CAP_BPS, etc.).");
    println!();

    for (di, &distance_bps) in DISTANCE_BPS_LIST.iter().enumerate() {
        for (oi, &offset_ms) in OFFSET_MS_LIST.iter().enumerate() {
            for (durj, &duration_ms) in DURATION_MS_LIST.iter().enumerate() {
                let p =
                    hits[di][durj][oi] as f64 / SAMPLES_PER_CELL as f64;
                println!("[[multiplier.empirical_cells]]");
                println!("distance_bps          = {}", distance_bps);
                println!("duration_ms           = {}", duration_ms);
                println!("window_start_offset_ms = {}", offset_ms);
                println!("p_touch               = {:.4}", p);
                println!();
            }
        }
    }

    eprintln!(
        "Done in {:.1}s. {} cells written.",
        started.elapsed().as_secs_f64(),
        DISTANCE_BPS_LIST.len() * DURATION_MS_LIST.len() * OFFSET_MS_LIST.len()
    );
}
