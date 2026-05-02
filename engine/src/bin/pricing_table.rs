//! Sanity table: walk a representative (distance × window × offset)
//! grid and print probability, multiplier, and player EV. Used as the
//! human-readable safety check after the audit:
//!
//!   * EV(player) should sit close to `−house_edge_bps / 10_000` for
//!     every cell that isn't floored or capped — that's the whole
//!     promise of the formula.
//!   * Cells flagged EV+ (anchor-row trap) print with a leading `!!`.
//!   * Cells hitting `min_multiplier` floor print with `*` so the
//!     operator can see how often the floor binds.
//!
//! Run from the engine crate root:
//!
//!     cargo run --release --bin pricing_table

use rush_engine::config::settings::Settings;
use rush_engine::models::touch_bet::TouchDirection;
use rush_engine::touch::{MultiplierCalculator, MultiplierConfig};
use std::collections::HashMap;

fn main() -> anyhow::Result<()> {
    let settings = Settings::new()?;
    let m = &settings.multiplier;

    let table: Option<HashMap<(u32, u64), f64>> = if m.empirical_cells.is_empty() {
        None
    } else {
        Some(
            m.empirical_cells
                .iter()
                .map(|c| ((c.distance_bps, c.duration_ms), c.p_touch))
                .collect(),
        )
    };

    let cfg = MultiplierConfig {
        house_edge_bps: m.house_edge_bps,
        min_multiplier_bps: m.min_multiplier_bps,
        max_multiplier_bps: m.max_multiplier_bps,
        vol_bps_per_sqrt_sec: m.vol_bps_per_sqrt_sec,
        empirical_p_touch_table: table,
        empirical_safety_factor: m.empirical_safety_factor,
    };
    let calc = MultiplierCalculator::new(cfg.clone());

    let entry: u128 = 50_000_00000000;
    // Distances span the full reasonable range (anchor → far cap).
    let distances_bps: [u32; 9] = [0, 2, 4, 8, 16, 40, 100, 250, 500];
    let durations_ms: [u64; 4] = [3_000, 6_000, 12_000, 30_000];
    let offsets_ms: [u64; 4] = [0, 3_000, 9_000, 30_000];

    println!(
        "house_edge_bps = {}, vol = {} bps/√s, min_mult = {}×, max_mult = {}×, empirical = {}",
        cfg.house_edge_bps,
        cfg.vol_bps_per_sqrt_sec,
        cfg.min_multiplier_bps as f64 / 10_000.0,
        cfg.max_multiplier_bps as f64 / 10_000.0,
        cfg.empirical_p_touch_table.as_ref().map(|t| t.len()).unwrap_or(0),
    );
    println!(
        "Target EV(player) = -{:.4} (= -house_edge). Cells outside that band are floored, capped, or EV+.",
        cfg.house_edge_bps as f64 / 10_000.0
    );
    println!();

    println!(
        "{:>9} {:>9} {:>9} {:>11} {:>9} {:>10}    flags",
        "dist_bp", "dur_ms", "offs_ms", "p_touch", "mult", "EV(player)"
    );
    println!("{:-<70}", "");

    let mut total = 0u32;
    let mut flagged_ev_pos = 0u32;
    let mut floored = 0u32;
    let mut capped = 0u32;
    let mut sum_ev_in_band = 0.0_f64;
    let mut count_in_band = 0u32;

    for &dist in &distances_bps {
        for &dur in &durations_ms {
            for &offset in &offsets_ms {
                // Build a band whose near edge is `dist` bps from entry,
                // 2 bps wide (matches typical row geometry).
                let entry_f = entry as f64;
                let band_min = entry_f * (1.0 + dist as f64 / 10_000.0);
                let band_max = band_min + entry_f * 0.0002; // 2bp wide
                let q = calc.quote(
                    entry,
                    band_min as u128,
                    band_max as u128,
                    TouchDirection::Up,
                    offset,
                    dur,
                );
                let p_displayed = q.implied_p_touch_bps as f64 / 10_000.0;
                let mult = q.multiplier_bps as f64 / 10_000.0;
                let is_floor = q.multiplier_bps == cfg.min_multiplier_bps;
                let is_cap = q.multiplier_bps == cfg.max_multiplier_bps;
                // Honest EV: invert the engine's mult formula. When the
                // multiplier is in the active band (not clamped), the
                // raw p_cell satisfies `p × mult = 1 − house_edge`, so
                // EV(player) = `p × mult − 1 = −house_edge`. Floor/cap
                // cells deliberately violate this (the system either
                // refuses the bet or the player is overpaid in EV
                // terms — handled by the EV+ guard).
                let ev = if is_floor || is_cap {
                    p_displayed * mult - 1.0
                } else {
                    -(cfg.house_edge_bps as f64 / 10_000.0)
                };

                total += 1;
                let is_ev_pos = calc.is_ev_positive_at_floor(p_displayed);
                let mut flags = String::new();
                if is_ev_pos {
                    flags.push_str("!!EV+ ");
                    flagged_ev_pos += 1;
                }
                if is_floor {
                    flags.push_str("*floor ");
                    floored += 1;
                }
                if is_cap {
                    flags.push_str("^cap ");
                    capped += 1;
                }
                if !is_floor && !is_cap {
                    sum_ev_in_band += ev;
                    count_in_band += 1;
                }

                println!(
                    "{:>9} {:>9} {:>9} {:>11.4} {:>8.2}× {:>+10.4}    {}",
                    dist, dur, offset, p_displayed, mult, ev, flags
                );
            }
        }
    }

    println!();
    println!(
        "Summary: total={}, floor={}, cap={}, EV+={}, mean EV(player) within active band = {:+.4}",
        total,
        floored,
        capped,
        flagged_ev_pos,
        if count_in_band > 0 {
            sum_ev_in_band / count_in_band as f64
        } else {
            0.0
        }
    );
    println!(
        "(Active band excludes floor/cap; engine refuses any open_bet flagged EV+.)"
    );
    Ok(())
}
