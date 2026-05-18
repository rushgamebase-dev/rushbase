//! Server-side Tap Trading quote-matrix audit harness.
//!
//! This is a dry-run safety gate for the Euphoria-style matrix feed:
//! it builds the same absolute price/time cells that `/trade/quote-matrix`
//! serves, quotes them with the engine's current config, and fails if
//! a dangerous multiplier appears.
//!
//! Run from the engine crate root:
//!
//!     cargo run --release --bin audit_quote_matrix
//!
//! Optional env overrides:
//!
//!     AUDIT_PRICE_BTCUSDT=77000 AUDIT_ROWS_EACH_SIDE=260 AUDIT_COLUMNS=5 \
//!       cargo run --release --bin audit_quote_matrix

use anyhow::{bail, Context};
use rush_engine::config::settings::Settings;
use rush_engine::models::touch_bet::TouchDirection;
use rush_engine::touch::{MultiplierCalculator, MultiplierConfig};
use std::collections::HashMap;

const DEFAULT_DURATION_MS: u64 = 5_000;
const DEFAULT_COLUMNS: usize = 5;
const DEFAULT_ROWS_EACH_SIDE: i64 = 260;
const EASY_DISTANCE_BPS: u32 = 5;
const NEAR_MAX_MULTIPLIER_BPS: u32 = 11_000;

#[derive(Debug, Clone, Copy)]
struct Asset {
    symbol: &'static str,
    price_step_usd: f64,
    default_price_usd: f64,
}

#[derive(Debug, Clone)]
struct AuditCell {
    price_index: i64,
    offset_ms: u64,
    distance_bps: u32,
    implied_p_touch_bps: u32,
    multiplier_bps: u32,
    enabled: bool,
    max_stake_wei: u128,
}

#[derive(Debug, Default)]
struct AssetReport {
    enabled: usize,
    disabled: usize,
    max_multiplier_bps: u32,
    first_up_bps: Option<u32>,
    first_down_bps: Option<u32>,
    failures: Vec<String>,
}

fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let settings = Settings::new().context("load engine settings")?;
    let duration_ms = env_u64("AUDIT_DURATION_MS", DEFAULT_DURATION_MS)?;
    let columns = env_usize("AUDIT_COLUMNS", DEFAULT_COLUMNS)?;
    let rows_each_side = env_i64("AUDIT_ROWS_EACH_SIDE", DEFAULT_ROWS_EACH_SIDE)?;

    if !settings.touch.allowed_window_ms.contains(&duration_ms) {
        bail!(
            "AUDIT_DURATION_MS={} is not in touch.allowed_window_ms={:?}",
            duration_ms,
            settings.touch.allowed_window_ms
        );
    }

    let calc = build_calculator(&settings);
    let max_payout_wei = settings
        .risk
        .max_payout_per_bet_wei
        .parse::<u128>()
        .context("risk.max_payout_per_bet_wei must fit u128")?;

    println!("Tap Trading quote-matrix audit");
    println!(
        "duration={}ms columns={} rows_each_side={} min_mult={:.2}x max_mult={:.2}x house_edge={}bps max_payout_wei={}",
        duration_ms,
        columns,
        rows_each_side,
        settings.multiplier.min_multiplier_bps as f64 / 10_000.0,
        settings.multiplier.max_multiplier_bps as f64 / 10_000.0,
        settings.multiplier.house_edge_bps,
        max_payout_wei,
    );
    println!(
        "rules: easy cells <= {}bps must pay <= {:.2}x; monotonic by distance; EV must stay <= 0; stake cap must not exceed max payout",
        EASY_DISTANCE_BPS,
        NEAR_MAX_MULTIPLIER_BPS as f64 / 10_000.0,
    );
    println!();

    let assets = [
        Asset {
            symbol: "ETHUSDT",
            price_step_usd: 0.50,
            default_price_usd: 3_000.0,
        },
        Asset {
            symbol: "BTCUSDT",
            price_step_usd: 10.0,
            default_price_usd: 77_000.0,
        },
        Asset {
            symbol: "SOLUSDT",
            price_step_usd: 0.02,
            default_price_usd: 170.0,
        },
    ];

    let mut all_failures = Vec::new();
    for asset in assets {
        let price = asset_price(asset)?;
        let report = audit_asset(
            &settings,
            &calc,
            asset,
            price,
            duration_ms,
            columns,
            rows_each_side,
            max_payout_wei,
        );
        println!(
            "{:<7} price=${:<10.4} step=${:<7} quoted={} disabled={} first_up={} first_down={} max={:.2}x",
            asset.symbol,
            price,
            asset.price_step_usd,
            report.enabled,
            report.disabled,
            fmt_bps(report.first_up_bps),
            fmt_bps(report.first_down_bps),
            report.max_multiplier_bps as f64 / 10_000.0,
        );
        all_failures.extend(report.failures);
    }

    if !all_failures.is_empty() {
        println!();
        println!("FAILURES:");
        for failure in &all_failures {
            println!("- {}", failure);
        }
        bail!(
            "quote-matrix audit failed with {} issue(s)",
            all_failures.len()
        );
    }

    println!();
    println!("PASS: quote-matrix safety rules hold for ETH/BTC/SOL.");
    Ok(())
}

fn build_calculator(settings: &Settings) -> MultiplierCalculator {
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

    MultiplierCalculator::new(MultiplierConfig {
        house_edge_bps: m.house_edge_bps,
        min_multiplier_bps: m.min_multiplier_bps,
        max_multiplier_bps: m.max_multiplier_bps,
        vol_bps_per_sqrt_sec: m.vol_bps_per_sqrt_sec,
        empirical_p_touch_table: table,
        empirical_safety_factor: m.empirical_safety_factor,
    })
}

fn audit_asset(
    settings: &Settings,
    calc: &MultiplierCalculator,
    asset: Asset,
    price_usd: f64,
    duration_ms: u64,
    columns: usize,
    rows_each_side: i64,
    max_payout_wei: u128,
) -> AssetReport {
    let entry_q8 = usd_to_q8(price_usd);
    let price_interval_q8 = usd_to_q8(asset.price_step_usd);
    let center_index = (entry_q8 / price_interval_q8) as i64;

    let mut report = AssetReport::default();
    let mut cells = Vec::new();

    for col in 0..columns {
        let offset_ms = (col as u64).saturating_mul(duration_ms);
        for price_index in (center_index - rows_each_side)..=(center_index + rows_each_side) {
            let cell = quote_audit_cell(
                settings,
                calc,
                entry_q8,
                price_interval_q8,
                price_index,
                offset_ms,
                duration_ms,
                max_payout_wei,
            );
            if cell.enabled {
                report.enabled += 1;
                report.max_multiplier_bps = report.max_multiplier_bps.max(cell.multiplier_bps);
                check_enabled_cell(asset, &cell, max_payout_wei, &mut report.failures);
            } else {
                report.disabled += 1;
            }
            cells.push(cell);
        }
    }

    report.first_up_bps = nearest_enabled(&cells, center_index, true);
    report.first_down_bps = nearest_enabled(&cells, center_index, false);
    check_first_cells(
        asset,
        report.first_up_bps,
        report.first_down_bps,
        &mut report.failures,
    );
    check_monotonic_by_distance(
        asset,
        &cells,
        center_index,
        columns,
        duration_ms,
        &mut report.failures,
    );

    report
}

fn quote_audit_cell(
    settings: &Settings,
    calc: &MultiplierCalculator,
    entry_q8: u128,
    price_interval_q8: u128,
    price_index: i64,
    offset_ms: u64,
    duration_ms: u64,
    max_payout_wei: u128,
) -> AuditCell {
    if price_index < 0 {
        return disabled_cell(price_index, offset_ms);
    }

    let band_min = price_interval_q8.saturating_mul(price_index as u128);
    let band_max = band_min.saturating_add(price_interval_q8);
    let direction = if band_min >= entry_q8 {
        TouchDirection::Up
    } else {
        TouchDirection::Down
    };
    let q = calc.quote_with_empirical(
        entry_q8,
        band_min,
        band_max,
        direction,
        offset_ms,
        duration_ms,
        false,
    );
    let p_touch = q.implied_p_touch_bps as f64 / 10_000.0;
    let disabled_reason = if q.distance_bps == 0 {
        Some("INSIDE_PRICE")
    } else if q.distance_bps < settings.touch.min_distance_bps {
        Some("TOO_CLOSE")
    } else if q.distance_bps > settings.touch.max_distance_bps {
        Some("TOO_FAR")
    } else if calc.is_ev_positive_at_floor(p_touch) {
        Some("EV_POSITIVE")
    } else {
        None
    };

    if disabled_reason.is_some() {
        return AuditCell {
            price_index,
            offset_ms,
            distance_bps: q.distance_bps,
            implied_p_touch_bps: q.implied_p_touch_bps,
            multiplier_bps: 0,
            enabled: false,
            max_stake_wei: 0,
        };
    }

    let multiplier_bps = round_matrix_multiplier_bps(q.multiplier_bps);
    let max_stake_wei = if multiplier_bps > 0 {
        max_payout_wei.saturating_mul(10_000) / multiplier_bps as u128
    } else {
        0
    };

    AuditCell {
        price_index,
        offset_ms,
        distance_bps: q.distance_bps,
        implied_p_touch_bps: q.implied_p_touch_bps,
        multiplier_bps,
        enabled: true,
        max_stake_wei,
    }
}

fn disabled_cell(price_index: i64, offset_ms: u64) -> AuditCell {
    AuditCell {
        price_index,
        offset_ms,
        distance_bps: 0,
        implied_p_touch_bps: 0,
        multiplier_bps: 0,
        enabled: false,
        max_stake_wei: 0,
    }
}

fn check_enabled_cell(
    asset: Asset,
    cell: &AuditCell,
    max_payout_wei: u128,
    failures: &mut Vec<String>,
) {
    if cell.distance_bps <= EASY_DISTANCE_BPS && cell.multiplier_bps > NEAR_MAX_MULTIPLIER_BPS {
        failures.push(format!(
            "{} easy cell distance={}bps offset={}ms pays {:.2}x",
            asset.symbol,
            cell.distance_bps,
            cell.offset_ms,
            cell.multiplier_bps as f64 / 10_000.0
        ));
    }

    let ev = (cell.implied_p_touch_bps as f64 / 10_000.0) * (cell.multiplier_bps as f64 / 10_000.0)
        - 1.0;
    if ev > 0.0001 {
        failures.push(format!(
            "{} positive-EV cell distance={}bps offset={}ms mult={:.2}x ev={:+.4}",
            asset.symbol,
            cell.distance_bps,
            cell.offset_ms,
            cell.multiplier_bps as f64 / 10_000.0,
            ev
        ));
    }

    let payout_at_max_stake = cell
        .max_stake_wei
        .saturating_mul(cell.multiplier_bps as u128)
        / 10_000;
    if payout_at_max_stake > max_payout_wei {
        failures.push(format!(
            "{} max stake exceeds payout cap: stake={} mult_bps={} payout={} cap={}",
            asset.symbol,
            cell.max_stake_wei,
            cell.multiplier_bps,
            payout_at_max_stake,
            max_payout_wei
        ));
    }
}

fn check_first_cells(
    asset: Asset,
    first_up_bps: Option<u32>,
    first_down_bps: Option<u32>,
    failures: &mut Vec<String>,
) {
    for (side, value) in [("up", first_up_bps), ("down", first_down_bps)] {
        match value {
            Some(multiplier_bps) if multiplier_bps <= NEAR_MAX_MULTIPLIER_BPS => {}
            Some(multiplier_bps) => failures.push(format!(
                "{} first {} cell pays {:.2}x; expected <= {:.2}x",
                asset.symbol,
                side,
                multiplier_bps as f64 / 10_000.0,
                NEAR_MAX_MULTIPLIER_BPS as f64 / 10_000.0
            )),
            None => failures.push(format!(
                "{} has no enabled first {} cell",
                asset.symbol, side
            )),
        }
    }
}

fn check_monotonic_by_distance(
    asset: Asset,
    cells: &[AuditCell],
    center_index: i64,
    columns: usize,
    duration_ms: u64,
    failures: &mut Vec<String>,
) {
    for col in 0..columns {
        let offset_ms = (col as u64).saturating_mul(duration_ms);
        check_side_monotonic(asset, cells, center_index, offset_ms, true, failures);
        check_side_monotonic(asset, cells, center_index, offset_ms, false, failures);
    }
}

fn check_side_monotonic(
    asset: Asset,
    cells: &[AuditCell],
    center_index: i64,
    offset_ms: u64,
    up: bool,
    failures: &mut Vec<String>,
) {
    let mut side_cells: Vec<&AuditCell> = cells
        .iter()
        .filter(|cell| {
            cell.enabled
                && cell.offset_ms == offset_ms
                && if up {
                    cell.price_index > center_index
                } else {
                    cell.price_index < center_index
                }
        })
        .collect();
    side_cells.sort_by_key(|cell| cell.distance_bps);

    let mut previous: Option<&AuditCell> = None;
    for cell in side_cells {
        if let Some(prev) = previous {
            if cell.multiplier_bps + 100 < prev.multiplier_bps {
                failures.push(format!(
                    "{} {} side not monotonic at offset={}ms: {}bps {:.2}x -> {}bps {:.2}x",
                    asset.symbol,
                    if up { "up" } else { "down" },
                    offset_ms,
                    prev.distance_bps,
                    prev.multiplier_bps as f64 / 10_000.0,
                    cell.distance_bps,
                    cell.multiplier_bps as f64 / 10_000.0
                ));
            }
        }
        previous = Some(cell);
    }
}

fn nearest_enabled(cells: &[AuditCell], center_index: i64, up: bool) -> Option<u32> {
    cells
        .iter()
        .filter(|cell| {
            cell.enabled
                && cell.offset_ms == 0
                && if up {
                    cell.price_index > center_index
                } else {
                    cell.price_index < center_index
                }
        })
        .min_by_key(|cell| cell.distance_bps)
        .map(|cell| cell.multiplier_bps)
}

fn round_matrix_multiplier_bps(multiplier_bps: u32) -> u32 {
    ((multiplier_bps + 50) / 100).saturating_mul(100)
}

fn usd_to_q8(value: f64) -> u128 {
    (value * 100_000_000.0).round().max(0.0) as u128
}

fn asset_price(asset: Asset) -> anyhow::Result<f64> {
    let key = format!("AUDIT_PRICE_{}", asset.symbol);
    match std::env::var(&key) {
        Ok(value) => value
            .parse::<f64>()
            .with_context(|| format!("{} must be a decimal price", key)),
        Err(std::env::VarError::NotPresent) => Ok(asset.default_price_usd),
        Err(error) => Err(error).with_context(|| format!("read {}", key)),
    }
}

fn env_u64(name: &str, default: u64) -> anyhow::Result<u64> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .with_context(|| format!("{} must be u64", name)),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("read {}", name)),
    }
}

fn env_usize(name: &str, default: usize) -> anyhow::Result<usize> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .with_context(|| format!("{} must be usize", name)),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("read {}", name)),
    }
}

fn env_i64(name: &str, default: i64) -> anyhow::Result<i64> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<i64>()
            .with_context(|| format!("{} must be i64", name)),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("read {}", name)),
    }
}

fn fmt_bps(value: Option<u32>) -> String {
    value
        .map(|bps| format!("{:.2}x", bps as f64 / 10_000.0))
        .unwrap_or_else(|| "none".to_string())
}
