//! Empirical calibration of `vol_bps_per_sqrt_sec` against real
//! Binance BTC/ETH market data. Pulls 1-second klines from the public
//! Binance API, slides each (distance_bps, duration_s) test window
//! through the price series, counts how often the price actually
//! touched the band, and compares against what the engine's Bachelier-
//! style formula predicts.
//!
//! What the output answers:
//!
//!   1. For every distance/duration the engine quotes, what is the
//!      REALISED `p_touch` over the past N days?
//!   2. Given the engine's currently-quoted multiplier, what is the
//!      player's expected value? Positive EV at any cell ⇒ the player
//!      can drain the house with a script.
//!   3. What `vol_bps_per_sqrt_sec` should we set so the engine's
//!      `p_touch` matches reality across the whole grid (least-squares
//!      best fit)?
//!
//! Run from the engine crate root:
//!
//!     cargo run --release --bin calibrate_vol -- BTCUSDT 7
//!
//! ...for "BTCUSDT, last 7 days". CSV of raw klines is dumped to
//! `calibration_<symbol>_<days>d.csv` so reruns can skip the network
//! fetch.
//!
//! NOTE: Binance's public REST is rate-limited (~6000 req/min). For
//! 7 days × 86_400 secs = 604_800 candles ÷ 1000 per call = 605 calls;
//! comfortably under the limit. 30 days = 2_592 calls, ~30 seconds
//! of fetching with the conservative inter-call delay we use.

use reqwest::Client;
use rush_engine::config::settings::MultiplierConfig as TomlMultiplierConfig;
use rush_engine::models::touch_bet::TouchDirection;
use rush_engine::touch::{MultiplierCalculator, MultiplierConfig};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Candle {
    open_ms: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
}

/// Binance kline payload — array form, one row = one candle.
#[derive(Debug, Deserialize)]
struct RawKline(
    i64,    // 0: open_ms
    String, // 1: open
    String, // 2: high
    String, // 3: low
    String, // 4: close
    String, // 5: volume
    i64,    // 6: close_ms
    String, // 7: quote_volume
    i64,    // 8: trades
    String, // 9: taker_buy_base
    String, // 10: taker_buy_quote
    String, // 11: ignore
);

impl From<RawKline> for Candle {
    fn from(r: RawKline) -> Self {
        Candle {
            open_ms: r.0,
            open: r.1.parse().unwrap_or(0.0),
            high: r.2.parse().unwrap_or(0.0),
            low: r.3.parse().unwrap_or(0.0),
            close: r.4.parse().unwrap_or(0.0),
        }
    }
}

async fn fetch_klines(
    client: &Client,
    symbol: &str,
    interval: &str,
    start_ms: i64,
    end_ms: i64,
) -> anyhow::Result<Vec<Candle>> {
    let mut out = Vec::with_capacity(((end_ms - start_ms) / 1_000) as usize);
    let mut cursor = start_ms;
    let mut page = 0u32;
    while cursor < end_ms {
        page += 1;
        let url = format!(
            "https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&startTime={cursor}&limit=1000"
        );
        let resp = client.get(&url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Binance returned {}: {}", status, body);
        }
        let raws: Vec<RawKline> = resp.json().await?;
        if raws.is_empty() {
            break;
        }
        let last_close = raws.last().map(|r| r.6).unwrap_or(cursor);
        let parsed: Vec<Candle> = raws.into_iter().map(Candle::from).collect();
        eprintln!(
            "  page {page}: {} candles, cursor → {} ({} %)",
            parsed.len(),
            last_close,
            ((last_close - start_ms) as f64 / (end_ms - start_ms).max(1) as f64 * 100.0) as u32
        );
        out.extend(parsed);
        cursor = last_close + 1;
        // Conservative spacing — Binance's burst limit is 6000 req/min;
        // we stay well under to avoid being throttled mid-fetch.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(out)
}

fn save_csv(path: &Path, candles: &[Candle]) -> anyhow::Result<()> {
    let f = File::create(path)?;
    let mut w = BufWriter::new(f);
    writeln!(w, "open_ms,open,high,low,close")?;
    for c in candles {
        writeln!(w, "{},{},{},{},{}", c.open_ms, c.open, c.high, c.low, c.close)?;
    }
    w.flush()?;
    Ok(())
}

fn load_csv(path: &Path) -> anyhow::Result<Vec<Candle>> {
    let f = File::open(path)?;
    let r = BufReader::new(f);
    let mut out = Vec::new();
    for (i, line) in r.lines().enumerate() {
        let line = line?;
        if i == 0 {
            continue;
        }
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() != 5 {
            continue;
        }
        out.push(Candle {
            open_ms: parts[0].parse()?,
            open: parts[1].parse()?,
            high: parts[2].parse()?,
            low: parts[3].parse()?,
            close: parts[4].parse()?,
        });
    }
    Ok(out)
}

/// Empirical touch probability over `[i, i+window)` candles for a band
/// `[entry, entry * (1 + distance_bps/10_000)]` (UP) or the symmetric
/// DOWN. Slides the window across the entire series and returns the
/// fraction of windows where the band was touched.
fn empirical_p_touch(
    candles: &[Candle],
    distance_bps: u32,
    window_secs: usize,
    direction: TouchDirection,
) -> (f64, u64) {
    if candles.len() <= window_secs {
        return (0.0, 0);
    }
    let mut touches = 0u64;
    let mut samples = 0u64;
    for i in 0..(candles.len() - window_secs) {
        let entry = candles[i].open;
        if entry <= 0.0 {
            continue;
        }
        let mut hi = f64::MIN;
        let mut lo = f64::MAX;
        for j in i..(i + window_secs) {
            if candles[j].high > hi {
                hi = candles[j].high;
            }
            if candles[j].low < lo {
                lo = candles[j].low;
            }
        }
        let touched = match direction {
            TouchDirection::Up => {
                let target = entry * (1.0 + distance_bps as f64 / 10_000.0);
                hi >= target
            }
            TouchDirection::Down => {
                let target = entry * (1.0 - distance_bps as f64 / 10_000.0);
                lo <= target
            }
        };
        if touched {
            touches += 1;
        }
        samples += 1;
    }
    (touches as f64 / samples as f64, samples)
}

/// Recompute `predicted_p_touch` for an arbitrary `vol_bps_per_sqrt_sec`,
/// using the engine's `MultiplierCalculator`. Only touches the
/// distance + duration knobs; everything else stays at production
/// defaults (`house_edge_bps`, `min/max_multiplier_bps`).
fn predicted_p_touch(vol: f64, distance_bps: u32, duration_s: u64) -> f64 {
    let calc = MultiplierCalculator::new(MultiplierConfig {
        house_edge_bps: 500,
        min_multiplier_bps: 11_000,
        max_multiplier_bps: 90_000,
        vol_bps_per_sqrt_sec: vol,
        ..Default::default()
    });
    // Build a synthetic band exactly `distance_bps` away from a
    // round-number entry. The actual entry value is irrelevant — the
    // engine only sees relative distance.
    let entry_q8: u128 = 50_000_00000000;
    let band_min = entry_q8 + (entry_q8 * distance_bps as u128) / 10_000;
    let band_max = band_min + 1; // any positive width
    let q = calc.quote(
        entry_q8,
        band_min,
        band_max,
        TouchDirection::Up,
        0, // calibration always assumes window starts immediately
        duration_s * 1_000,
    );
    q.implied_p_touch_bps as f64 / 10_000.0
}

/// Best-fit vol via discrete grid search over the realised data. We
/// minimise the sum of squared log-ratio errors:
///   loss(vol) = Σ (log(p_real / p_predicted(vol)))²
/// across every (distance, duration) cell in the test grid. Log-ratio
/// keeps tail cells from dominating where absolute errors are tiny.
fn best_fit_vol(
    grid: &[(u32, u64, f64)], // (distance, duration, p_real)
    candidates: &[f64],
) -> (f64, f64) {
    let mut best_vol = candidates[0];
    let mut best_loss = f64::INFINITY;
    for &v in candidates {
        let mut loss = 0.0;
        for &(d, dur, p_real) in grid {
            if p_real <= 0.0 {
                continue;
            }
            let p_pred = predicted_p_touch(v, d, dur).max(1e-9);
            let r = (p_real / p_pred).ln();
            loss += r * r;
        }
        if loss < best_loss {
            best_loss = loss;
            best_vol = v;
        }
    }
    (best_vol, best_loss)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Quiet-warning: production engine uses TomlMultiplierConfig; we
    // import it just to make the cross-reference explicit in the file.
    let _: Option<TomlMultiplierConfig> = None;

    let args: Vec<String> = env::args().collect();
    let symbol = args.get(1).map(String::as_str).unwrap_or("BTCUSDT");
    let days: i64 = args
        .get(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(7);

    eprintln!("=== vol_bps_per_sqrt_sec calibration ===");
    eprintln!("Symbol  : {symbol}");
    eprintln!("Days    : {days}");

    let now_ms = chrono::Utc::now().timestamp_millis();
    let start_ms = now_ms - days * 86_400_000;

    let csv_path = format!("calibration_{}_{}d.csv", symbol, days);
    let csv_path = Path::new(&csv_path);

    let candles: Vec<Candle> = if csv_path.exists() {
        eprintln!("Reusing cached {}", csv_path.display());
        load_csv(csv_path)?
    } else {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("rush-engine/calibrate_vol")
            .build()?;
        eprintln!("Fetching 1s klines from Binance ({} → {})...", start_ms, now_ms);
        let candles = fetch_klines(&client, symbol, "1s", start_ms, now_ms).await?;
        eprintln!("Got {} candles, persisting to {}", candles.len(), csv_path.display());
        save_csv(csv_path, &candles)?;
        candles
    };
    eprintln!();

    // Grid v2: distances cover the frontend `PRICE_STEP_BPS=2` range plus
    // wider tiers; durations match `allowed_window_ms` in the engine
    // config exactly so the calibration table can be pasted verbatim
    // into `[[multiplier.empirical_cells]]`.
    let distances: &[u32] = &[2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 60];
    let durations: &[u64] = &[3, 6, 9, 12, 18, 30, 60];

    // Allow CLI override: third arg is vol to evaluate (defaults to current
    // production value). Useful for "what-if" scans without recompiling.
    let production_vol: f64 = args
        .get(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(2.8_f64); // current default in config/default.toml

    println!(
        "{:<5} {:<5} {:<10} {:<14} {:<14} {:<10} {:<8} {:<10}",
        "Dist", "Win", "Real_p", "Pred_p (cur)", "Engine mult", "Real EV", "House%", "Verdict"
    );
    println!("{}", "─".repeat(85));

    let mut grid: Vec<(u32, u64, f64)> = Vec::new();
    let mut any_player_positive = false;

    for &distance_bps in distances {
        for &duration_s in durations {
            let (real_p, samples) =
                empirical_p_touch(&candles, distance_bps, duration_s as usize, TouchDirection::Up);
            if samples == 0 {
                continue;
            }
            grid.push((distance_bps, duration_s, real_p));

            let pred_p = predicted_p_touch(production_vol, distance_bps, duration_s);
            // Engine's multiplier given pred_p (capped/floored).
            let raw_mult = (1.0 - 500.0 / 10_000.0) / pred_p.max(0.005);
            let mult = raw_mult.clamp(1.10, 9.0);

            // EV from the player's perspective: p * payout - stake.
            // payout = stake * mult, so EV/stake = p * mult - 1.
            let ev_pct = (real_p * mult - 1.0) * 100.0;
            let house_pct = -ev_pct;
            let verdict = if real_p * mult > 1.0 + 0.005 {
                any_player_positive = true;
                "⚠️  PLAYER+"
            } else if house_pct < 1.0 {
                "thin"
            } else {
                "house"
            };

            println!(
                "{:<5} {:<5} {:<10.4} {:<14.4} {:<14.3} {:<10.2} {:<8.2} {}",
                format!("{}bp", distance_bps),
                format!("{}s", duration_s),
                real_p,
                pred_p,
                mult,
                ev_pct,
                house_pct,
                verdict,
            );
        }
    }

    // Emit a paste-ready TOML snippet so the engine can ingest the same
    // table the calibrator just printed. Always writes — even when
    // PLAYER+ exists — so the operator can see what the table looks
    // like and decide on `empirical_safety_factor`.
    println!();
    println!("─── TOML snippet (paste into engine/config/default.toml) ───────");
    println!("# vol_bps_per_sqrt_sec is only used as Bachelier fallback for");
    println!("# off-grid (distance, duration) pairs. The empirical_cells");
    println!("# below are the source of truth for cells we calibrated.");
    for &(d, dur, p_real) in &grid {
        if p_real < 1e-6 {
            continue; // skip cells with no observed touches
        }
        println!("[[multiplier.empirical_cells]]");
        println!("distance_bps = {}", d);
        println!("duration_ms  = {}", dur * 1_000);
        println!("p_touch      = {:.6}", p_real);
    }

    println!();
    if any_player_positive {
        println!("⚠️  Player has POSITIVE EV at one or more cells with vol={production_vol}.");
        println!("   A scripted attacker can extract value sustained from the house at those cells.");
    } else {
        println!("All cells favour the house under vol={production_vol}.");
    }
    println!();

    // Best-fit vol via coarse grid then narrow.
    let coarse: Vec<f64> = (5..200).map(|i| i as f64 / 10.0).collect();
    let (best_coarse, _) = best_fit_vol(&grid, &coarse);
    let fine: Vec<f64> = ((best_coarse * 100.0 - 50.0).max(10.0) as i64
        ..(best_coarse * 100.0 + 50.0) as i64)
        .map(|i| i as f64 / 100.0)
        .collect();
    let (best_vol, loss) = best_fit_vol(&grid, &fine);
    println!("─── Recalibration ──────────────────────────────────────");
    println!("Best-fit vol_bps_per_sqrt_sec : {:.2}", best_vol);
    println!("LSE loss (lower better)       : {:.4}", loss);
    println!("Currently configured          : {:.2}", production_vol);
    println!();
    println!("To apply: edit `engine/config/default.toml`");
    println!("    [multiplier]");
    println!("    vol_bps_per_sqrt_sec = {:.2}", best_vol);
    println!("Then re-run this binary to confirm no cell shows PLAYER+.");

    Ok(())
}
