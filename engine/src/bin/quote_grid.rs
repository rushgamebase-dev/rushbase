//! Walk the full (distance × duration) grid the frontend exposes and
//! print the multiplier the engine *currently* quotes from the loaded
//! config. Used to verify the empirical table feeds through end-to-end
//! and that no cell either floors trivially or sits at the cap when
//! the empirical data says the touch is reachable.
//!
//! Run from the engine crate root:
//!
//!     cargo run --release --bin quote_grid

use rush_engine::config::settings::Settings;
use rush_engine::models::touch_bet::TouchDirection;
use rush_engine::touch::{MultiplierCalculator, MultiplierConfig};
use std::collections::HashMap;

fn main() -> anyhow::Result<()> {
    // Load the same config the engine boots from. Skip dotenv so we
    // don't trip over the `APP_BINANCE__SYMBOLS=foo,bar` form (the
    // engine has its own deserializer; this binary just wants the
    // multiplier section).
    let settings = Settings::new()?;
    let m = &settings.multiplier;

    let table: Option<HashMap<(u32, u64, u64), f64>> = if m.empirical_cells.is_empty() {
        None
    } else {
        Some(
            m.empirical_cells
                .iter()
                .map(|c| {
                    (
                        (c.distance_bps, c.duration_ms, c.window_start_offset_ms),
                        c.p_touch,
                    )
                })
                .collect(),
        )
    };

    let calc = MultiplierCalculator::new(MultiplierConfig {
        house_edge_bps: m.house_edge_bps,
        min_multiplier_bps: m.min_multiplier_bps,
        max_multiplier_bps: m.max_multiplier_bps,
        vol_bps_per_sqrt_sec: m.vol_bps_per_sqrt_sec,
        empirical_p_touch_table: table,
        empirical_safety_factor: m.empirical_safety_factor,
    });

    let distances: &[u32] = &[2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 60];
    let durations: &[u64] = &[3_000, 6_000, 9_000, 12_000, 18_000, 30_000, 60_000];

    println!(
        "house_edge_bps={}  min_mult={}  max_mult={}  vol={:.2}  safety={:.2}",
        m.house_edge_bps,
        m.min_multiplier_bps,
        m.max_multiplier_bps,
        m.vol_bps_per_sqrt_sec,
        m.empirical_safety_factor,
    );
    println!(
        "empirical_cells loaded: {} rows  → {}",
        m.empirical_cells.len(),
        if m.empirical_cells.is_empty() {
            "Bachelier-only"
        } else {
            "table + Bachelier fallback"
        }
    );
    println!();

    print!("{:<6}", "Dist");
    for d in durations {
        print!("{:>10}", format!("{}s", d / 1_000));
    }
    println!();
    println!("{}", "─".repeat(6 + 10 * durations.len()));

    let entry: u128 = 50_000_00000000;
    for &dbp in distances {
        print!("{:<6}", format!("{}bp", dbp));
        for &dur in durations {
            let band_min = entry + (entry * dbp as u128) / 10_000;
            let band_max = band_min + 1;
            let q = calc.quote(entry, band_min, band_max, TouchDirection::Up, 0, dur);
            let mult = q.multiplier_bps as f64 / 10_000.0;
            let p = q.implied_p_touch_bps as f64 / 10_000.0;
            let marker = if q.from_empirical { "e" } else { " " };
            print!("{:>9.2}{}", mult, marker);
            // Implied p suppressed in compact view but available via cell.
            let _ = p;
        }
        println!();
    }
    println!();
    println!("'e' suffix = empirical lookup hit; otherwise Bachelier fallback.");

    Ok(())
}
