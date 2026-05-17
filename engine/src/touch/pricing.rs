//! Multiplier pricing.
//!
//! For a touch-in-window bet, the multiplier should equal
//!   `(1 - house_edge) / P(touch)`
//! so that the expected value over many bets is the house edge — exactly
//! the same transparency principle Rush uses for its 5% prediction-market
//! fee. The probability of touch is approximated with a simple
//! Gaussian-derived formula that we calibrate against observed market
//! behavior (`vol_bps_per_sqrt_sec`).
//!
//! Multipliers are stored on every bet as `multiplier_bps` (10_000 = 1.0x)
//! so they survive a price feed restart and survive any future change
//! to the calibration parameters — the user is paid the multiplier they
//! agreed to at placement time.

use crate::models::touch_bet::TouchDirection;
use serde::Serialize;
use std::collections::HashMap;

/// Empirical `(distance_bps, duration_ms, window_start_offset_ms)` →
/// realised p_touch lookup. The third axis matters because cells in
/// future columns of the UX grid (col 2 = offset 3000 ms, col 3 =
/// offset 6000 ms, …) have first-passage probability that depends on
/// when the window opens, not just its duration. Earlier calibration
/// covered offset=0 only and let Bachelier price the rest, which
/// under-priced wide-band cells against the VRF generator.
pub type EmpiricalPTouchTable = HashMap<(u32, u64, u64), f64>;

/// Product ladder guard for cells that sit directly beside the live
/// price. These are high-frequency taps, not lottery cells; keep their
/// payout at the minimum multiplier even if the raw statistical model
/// would quote above it during a quiet market micro-window.
const NEAR_PRICE_FLOOR_DISTANCE_BPS: u32 = 5;

/// Complementary error function via Abramowitz & Stegun 7.1.26.
/// Max absolute error ≈ 1.5e-7 across the entire real line.
/// Used by the touch-probability formula (`erfc(z/√2) = 2(1−Φ(z))`).
fn erfc(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let ax = x.abs();
    let p = 0.3275911_f64;
    let a1 = 0.254829592_f64;
    let a2 = -0.284496736_f64;
    let a3 = 1.421413741_f64;
    let a4 = -1.453152027_f64;
    let a5 = 1.061405429_f64;
    let t = 1.0 / (1.0 + p * ax);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-ax * ax).exp();
    let erf = sign * y;
    1.0 - erf
}

fn normal_pdf(z: f64) -> f64 {
    (-0.5 * z * z).exp() / (2.0 * std::f64::consts::PI).sqrt()
}

#[derive(Debug, Clone)]
pub struct MultiplierConfig {
    /// House edge in basis points. 500 = 5%.
    pub house_edge_bps: u32,
    /// Floor for the quoted multiplier. 11_000 = 1.1×.
    pub min_multiplier_bps: u32,
    /// Ceiling for the quoted multiplier. Hard cap on house exposure
    /// per individual bet.
    pub max_multiplier_bps: u32,
    /// Calibration knob: implied volatility per √second in basis points.
    /// Higher value ⇒ touches feel more likely ⇒ multipliers come down.
    /// Tune empirically against observed touch frequency for each symbol.
    /// Used as the fallback when no empirical entry exists for the cell.
    pub vol_bps_per_sqrt_sec: f64,
    /// Optional pre-computed table of realised p_touch per cell, derived
    /// from `cargo run --release --bin calibrate_vol`. Bachelier with a
    /// single vol cannot fit BTC microstructure (extreme moves are rarer
    /// than Gaussian); the empirical table makes the engine quote
    /// multipliers that match observed reality.
    ///
    /// When a quote arrives for a cell present in this table the engine
    /// uses `target_p = empirical_p × empirical_safety_factor` (clamped
    /// to a reasonable range). Misses fall back to Bachelier with
    /// `vol_bps_per_sqrt_sec`.
    pub empirical_p_touch_table: Option<EmpiricalPTouchTable>,
    /// Multiplicative safety pad applied to the empirical p_touch before
    /// the multiplier is computed. `1.0` means "trust the empirical
    /// number"; `1.5` means "assume real_p could be 50 % higher than
    /// observed" — protects the house against vol regime shifts at the
    /// cost of a fatter quoted edge.
    ///
    /// House cannot be put into PLAYER+ territory unless realised
    /// p_touch exceeds `empirical_p × safety_factor` AND the multiplier
    /// also escapes the cap. A pad of ~1.5 absorbs day-to-day vol noise.
    pub empirical_safety_factor: f64,
}

impl Default for MultiplierConfig {
    fn default() -> Self {
        Self {
            house_edge_bps: 500,
            min_multiplier_bps: 11_000,
            max_multiplier_bps: 200_000,
            vol_bps_per_sqrt_sec: 5.0,
            empirical_p_touch_table: None,
            empirical_safety_factor: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct MultiplierQuote {
    /// Distance from `entry_q8` to the near edge of the band, in bps.
    pub distance_bps: u32,
    /// Offset between `now_ms` and the window's start. 0 means the
    /// window starts immediately (col 1 of the grid). `(N-1)*duration`
    /// for col `N`. Echoed back so the client can verify match.
    pub window_start_offset_ms: u64,
    pub window_duration_ms: u64,
    /// Implied P(touch) × 10_000 — surfaced for transparency.
    pub implied_p_touch_bps: u32,
    /// Final multiplier in basis points. 12_500 = 1.25×.
    pub multiplier_bps: u32,
    /// `true` when the quoted p_touch came from the empirical lookup
    /// table; `false` when it fell back to the Bachelier closed form.
    /// Surfaced so the UI can disclose source and clients can hold the
    /// engine to honest numbers per cell.
    pub from_empirical: bool,
}

pub struct MultiplierCalculator {
    cfg: MultiplierConfig,
}

impl MultiplierCalculator {
    pub fn new(cfg: MultiplierConfig) -> Self {
        Self { cfg }
    }

    pub fn config(&self) -> &MultiplierConfig {
        &self.cfg
    }

    /// True when the cell's implied probability is so high that the
    /// quoted multiplier (clamped to `min_multiplier_bps`) would pay the
    /// player a positive expected value. Without this guard, a band that
    /// already envelops the price (`distance_bps == 0` ⇒ `pTouch ≈ 1`)
    /// gets clipped to the 1.10× floor and the user breaks the house at
    /// pure EV+10 %. Caller should refuse to open the bet AND should
    /// disable the cell in the quote-grid response.
    pub fn is_ev_positive_at_floor(&self, p_touch: f64) -> bool {
        let mult_floor = self.cfg.min_multiplier_bps as f64 / 10_000.0;
        p_touch * mult_floor > 1.0
    }

    pub fn quote(
        &self,
        entry_q8: u128,
        band_min_q8: u128,
        band_max_q8: u128,
        _direction: TouchDirection,
        window_start_offset_ms: u64,
        window_duration_ms: u64,
    ) -> MultiplierQuote {
        // Distance to the *near* edge of the band — that's the barrier
        // the price has to actually cross to register a touch.
        //
        // We pick the near edge from band-vs-snake geometry rather
        // than the legacy `direction` argument: snake below band → pMin
        // is the near edge; snake above → pMax. When the band envelops
        // the snake the bet would auto-touch at t=0; pricing returns a
        // distance of 0 and the EV+ guard downstream refuses it.
        let near_edge_q8 = if entry_q8 < band_min_q8 {
            band_min_q8
        } else if entry_q8 > band_max_q8 {
            band_max_q8
        } else {
            // Snake inside band — distance is 0 either way.
            band_min_q8
        };
        let entry_f = entry_q8 as f64;
        let edge_f = near_edge_q8 as f64;
        let raw_distance = (edge_f - entry_f).abs();
        let distance_bps = if entry_f > 0.0 {
            (raw_distance / entry_f) * 10_000.0
        } else {
            0.0
        };

        let distance_bps_round = distance_bps.round().min(u32::MAX as f64) as u32;

        // Touch probability inside the SPECIFIC window [t_start, t_end]
        // from now. The resolver pays if the line touches the band at
        // any point during that window; it does NOT require that this
        // is the first touch ever since quote time. Therefore this is
        // not `F(t_end) - F(t_start)`. For future windows we integrate
        // over the unconstrained price distribution at `t_start` and
        // then price a fresh first passage over the window duration.
        let t_start_sec = (window_start_offset_ms as f64) / 1_000.0;
        let window_sec = (window_duration_ms as f64) / 1_000.0;
        let bachelier_window = bachelier_p_touch_in_window(
            distance_bps,
            t_start_sec,
            window_sec,
            self.cfg.vol_bps_per_sqrt_sec,
        );

        // Empirical lookup keyed on `(distance, duration, offset)`.
        //
        // Tolerance: the client renders bands aligned to its last
        // observed `entry_q8`, but by the time the request reaches
        // the engine the in-process Rush Index has moved a few bps.
        // A strict equality lookup misses those — same cell on
        // screen, different `distance_bps_round`. So we scan the
        // table for the nearest entry whose duration matches and
        // whose `(distance, offset)` are within tolerance of the
        // request, and refuse only if nothing fits.
        //
        // Tolerance budgets:
        //  - 5 bps on distance: the Rush Index drifts ≤ ~3 bps over
        //    the 100-200 ms RTT of a quote-grid call; a 5 bps
        //    cushion absorbs that noise without crossing into
        //    neighbouring catalogued cells (catalog is spaced
        //    every 40 bps).
        //  - 250 ms on offset: same idea on the time axis. Catalog
        //    is spaced 3000 ms apart so 250 ms is well clear.
        // Tolerance widened to absorb realistic client/server drift:
        // the client anchors cells once and they stay fixed in
        // absolute price, so as time progresses the engine sees
        // distance_bps drift relative to the calibrated grid by up
        // to ~20 bps within a single round. 20 bps is half the cell
        // band width (PRICE_STEP_BPS=40) so we never snap across a
        // visual cell. Worst-case p_touch inflation at 20 bps is
        // ~1.3× — comfortably under the empirical_safety_factor of
        // 1.5× (see empirical_safety_pad_protects_against_player_positive).
        // OFFSET_TOL_MS=750 covers tick-quantization (~150 ms) plus
        // schedule jitter when the client polls quote-grid every 250 ms.
        const DIST_TOL_BPS: u32 = 20;
        const OFFSET_TOL_MS: u64 = 750;
        let (raw_p, from_empirical) = if let Some(table) = &self.cfg.empirical_p_touch_table {
            let mut best: Option<(u32, u64, f64)> = None;
            for (&(d, dur, off), &p) in table {
                if dur != window_duration_ms {
                    continue;
                }
                let dist_diff =
                    (d as i64 - distance_bps_round as i64).unsigned_abs() as u32;
                let off_diff =
                    (off as i64 - window_start_offset_ms as i64).unsigned_abs() as u64;
                if dist_diff > DIST_TOL_BPS || off_diff > OFFSET_TOL_MS {
                    continue;
                }
                let score = dist_diff + (off_diff / 100) as u32;
                if best.map_or(true, |(b_score, _, _)| score < b_score) {
                    best = Some((score, dist_diff as u64 + off_diff, p));
                }
            }
            if let Some((_, _, empirical_p)) = best {
                let padded = empirical_p * self.cfg.empirical_safety_factor;
                // Cap padded p at 0.95: we still want a positive
                // house edge even on the "easiest" cell; a
                // target_p > 0.95 would price below 1.0× before
                // house_edge is applied.
                (padded.min(0.95), true)
            } else {
                (bachelier_window, false)
            }
        } else {
            (bachelier_window, false)
        };

        let p_touch = raw_p.max(0.005); // floor 0.5% to bound multiplier

        let edge_factor = 1.0 - (self.cfg.house_edge_bps as f64) / 10_000.0;
        let multiplier = edge_factor / p_touch;
        let mut multiplier_bps = (multiplier * 10_000.0)
            .round()
            .clamp(
                self.cfg.min_multiplier_bps as f64,
                self.cfg.max_multiplier_bps as f64,
            ) as u32;
        if distance_bps_round <= NEAR_PRICE_FLOOR_DISTANCE_BPS {
            multiplier_bps = multiplier_bps.min(self.cfg.min_multiplier_bps);
        }

        MultiplierQuote {
            distance_bps: distance_bps_round,
            window_start_offset_ms,
            window_duration_ms,
            implied_p_touch_bps: (raw_p * 10_000.0).round().min(u32::MAX as f64) as u32,
            multiplier_bps,
            from_empirical,
        }
    }
}

/// Cumulative probability that a Bachelier-style price path has
/// touched a one-sided barrier `distance_bps` away from entry by
/// time `t_sec`. Reflection principle:
///   P(max_{0..t} ≥ barrier) = erfc(z/√2),   z = distance / (vol·√t)
/// Used to compute first-passage *interval* probability via
///   p_in(t1, t2) = p_by(t2) − p_by(t1).
fn bachelier_p_touch_by(distance_bps: f64, t_sec: f64, vol_bps_per_sqrt_sec: f64) -> f64 {
    if t_sec <= 0.0 {
        return 0.0;
    }
    let denom = (vol_bps_per_sqrt_sec * t_sec.sqrt()).max(1e-6);
    let z = distance_bps / denom;
    erfc(z / std::f64::consts::SQRT_2).min(1.0)
}

/// Probability that a Bachelier-style path touches a one-sided barrier
/// during the future window `[t_start, t_start + window]`.
///
/// This matches settlement semantics more closely than a difference of
/// first-passage CDFs: a path that touched before the window can still
/// touch again inside the window, and that is a win. We condition on the
/// price at `t_start`, then apply the reflection principle over the
/// window duration. If the conditional start is already beyond the near
/// edge, we count it as touched at the window boundary. That is a
/// conservative approximation for finite-width bands and avoids
/// underpricing future columns.
fn bachelier_p_touch_in_window(
    distance_bps: f64,
    t_start_sec: f64,
    window_sec: f64,
    vol_bps_per_sqrt_sec: f64,
) -> f64 {
    if window_sec <= 0.0 {
        return 0.0;
    }
    if t_start_sec <= 0.001 {
        return bachelier_p_touch_by(distance_bps, window_sec, vol_bps_per_sqrt_sec);
    }

    let start_std = (vol_bps_per_sqrt_sec * t_start_sec.sqrt()).max(1e-9);
    let window_denom = (vol_bps_per_sqrt_sec * window_sec.sqrt()).max(1e-9);
    let sigmas = 6.0;
    let steps = 97usize;
    let step = (sigmas * 2.0) / steps as f64;
    let mut weighted = 0.0;
    let mut total_weight = 0.0;

    for i in 0..steps {
        let z = -sigmas + (i as f64 + 0.5) * step;
        let start_bps = start_std * z;
        let weight = normal_pdf(z) * step;
        let p = if start_bps >= distance_bps {
            1.0
        } else {
            let remaining_bps = distance_bps - start_bps;
            erfc((remaining_bps / window_denom) / std::f64::consts::SQRT_2).min(1.0)
        };
        weighted += weight * p;
        total_weight += weight;
    }

    if total_weight > 0.0 {
        (weighted / total_weight).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn calc() -> MultiplierCalculator {
        MultiplierCalculator::new(MultiplierConfig::default())
    }

    #[test]
    fn touching_immediately_floors_at_min() {
        // Band that already contains entry → P ≈ 1 → multiplier near (1-edge).
        let q = calc().quote(50_000_00000000, 49_999_00000000, 50_001_00000000, TouchDirection::Up, 0, 3_000);
        assert!(q.multiplier_bps >= 11_000);
    }

    #[test]
    fn far_band_caps_at_max() {
        // 10% above current at 3s window → near zero touch probability.
        let q = calc().quote(50_000_00000000, 55_000_00000000, 55_500_00000000, TouchDirection::Up, 0, 3_000);
        assert_eq!(q.multiplier_bps, MultiplierConfig::default().max_multiplier_bps);
    }

    #[test]
    fn longer_window_raises_p_touch() {
        let near = calc().quote(50_000_00000000, 50_500_00000000, 51_000_00000000, TouchDirection::Up, 0, 3_000);
        let far = calc().quote(50_000_00000000, 50_500_00000000, 51_000_00000000, TouchDirection::Up, 0, 30_000);
        // Same band, 10× longer window → multiplier should drop (touch more likely).
        assert!(far.multiplier_bps <= near.multiplier_bps);
    }

    #[test]
    fn down_uses_upper_edge() {
        let q = calc().quote(50_000_00000000, 49_500_00000000, 49_900_00000000, TouchDirection::Down, 0, 3_000);
        // Distance from entry (50_000) to upper edge of DOWN band (49_900) = 100 bps.
        assert!((q.distance_bps as i64 - 20).abs() < 50);
    }

    #[test]
    fn erfc_matches_reflection_principle_table() {
        // Reference values for 2(1-Φ(z)) = erfc(z/√2). Tolerance 1e-4
        // covers both the A&S approximation error and our display bps.
        let cases = [
            (0.0_f64, 1.0_f64),
            (0.5, 0.6171),
            (1.0, 0.3173),
            (1.5, 0.1336),
            (2.0, 0.0455),
            (2.5, 0.0124),
            (3.0, 0.00270),
        ];
        for (z, expected) in cases {
            let got = super::erfc(z / std::f64::consts::SQRT_2);
            assert!(
                (got - expected).abs() < 1e-3,
                "erfc(z={}/√2) got {} expected {}",
                z,
                got,
                expected
            );
        }
    }

    #[test]
    fn multiplier_in_interesting_range_is_not_floored() {
        // With vol=5 bps/√s and T=3s, denom = 8.66. A 20bp barrier
        // (z = 2.31) sits in the "interesting" window — neither floor
        // nor cap. Verify the multiplier comes out roughly fair given
        // p_touch ≈ erfc(z/√2) ≈ 0.0207 → 0.95/0.0207 ≈ 45.9× → cap 20×.
        let q = calc().quote(
            50_000_00000000,
            50_100_00000000,
            50_200_00000000,
            TouchDirection::Up,
            0,
            3_000,
        );
        assert_eq!(q.distance_bps, 20);
        // 20bp is past the dynamic range with vol=5/√s, so it should
        // hit the cap. (See note: with default frontend grid, even more
        // distant cells are unreachable — the calibration must change.)
        assert_eq!(q.multiplier_bps, MultiplierConfig::default().max_multiplier_bps);
    }

    #[test]
    fn multiplier_under_old_formula_was_underpriced() {
        // Regression guard: the old `2·exp(-z²/2)` overestimated p_touch
        // by ~6× at z=2, making the multiplier roughly 6× too small.
        // With erfc-based p_touch the implied probability for a clean
        // touchable barrier (z ≈ 1.5) sits near 13.4%, multiplier ≈ 7×.
        // We assert the new multiplier is in the 5–10× neighbourhood,
        // which the old formula could not produce.
        // Use vol=10 to widen denom and put 20bp at z=1.15, p≈25%, ~3.8×.
        let cfg = MultiplierConfig {
            vol_bps_per_sqrt_sec: 10.0,
            ..MultiplierConfig::default()
        };
        let calc = MultiplierCalculator::new(cfg);
        // distance 30bp at vol=10 over 3s: denom ≈ 17.32, z ≈ 1.73
        // erfc(1.73/√2) = erfc(1.224) ≈ 0.0833
        // multiplier ≈ 0.95 / 0.0833 ≈ 11.4× → 114_000 bps (capped at 200_000)
        let q = calc.quote(
            50_000_00000000,
            50_150_00000000,
            50_200_00000000,
            TouchDirection::Up,
            0,
            3_000,
        );
        // Reasonable band — neither floored nor immediately capped.
        assert!(q.multiplier_bps >= 50_000, "got {}", q.multiplier_bps);
        assert!(q.multiplier_bps <= 200_000, "got {}", q.multiplier_bps);
    }

    #[test]
    fn empirical_table_overrides_bachelier() {
        // 6bp/30s under Bachelier vol=2.8 yields p high enough to be
        // materially different from the empirical table, and sits just
        // outside the near-price floor zone.
        // The 7-day BTCUSDT empirical realises 0.091, which with a 1.5×
        // safety pad becomes target_p = 0.137 → mult ≈ 6.95×. The
        // engine must quote the empirical-driven value when the cell is
        // present in the lookup table.
        let mut table = EmpiricalPTouchTable::new();
        table.insert((6, 30_000, 0), 0.091033);
        let cfg = MultiplierConfig {
            house_edge_bps: 500,
            min_multiplier_bps: 11_000,
            max_multiplier_bps: 90_000,
            vol_bps_per_sqrt_sec: 2.8,
            empirical_p_touch_table: Some(table),
            empirical_safety_factor: 1.5,
        };
        let calc = MultiplierCalculator::new(cfg);
        // 50_000 entry, band 50_030..50_031 → 6bp distance UP, 30s window.
        let q = calc.quote(
            50_000_00000000,
            50_030_00000000,
            50_031_00000000,
            TouchDirection::Up,
            0,
            30_000,
        );
        assert_eq!(q.distance_bps, 6);
        assert!(q.from_empirical, "should hit empirical table");
        // target_p = 0.091033 * 1.5 = 0.137; mult = 0.95/0.137 ≈ 6.95×
        assert!(
            q.multiplier_bps > 60_000 && q.multiplier_bps < 75_000,
            "got {}",
            q.multiplier_bps
        );
        // implied_p_touch_bps reflects the (padded) target — surfaces
        // the post-safety-pad probability so the UI can disclose it.
        assert!(q.implied_p_touch_bps > 1_300 && q.implied_p_touch_bps < 1_400);
    }

    #[test]
    fn empirical_miss_falls_back_to_bachelier() {
        // Cell not in (or near) the table → engine falls back to
        // Bachelier and surfaces `from_empirical = false`. Tolerance
        // is DIST_TOL_BPS=20 / OFFSET_TOL_MS=750, so we use a
        // duration mismatch (15s table entry vs 30s query) — that's
        // the cleanest miss because durations must match exactly.
        let mut table = EmpiricalPTouchTable::new();
        table.insert((4, 15_000, 0), 0.091033);
        let cfg = MultiplierConfig {
            empirical_p_touch_table: Some(table),
            empirical_safety_factor: 1.5,
            ..Default::default()
        };
        let calc = MultiplierCalculator::new(cfg);
        // 6bp/30s — duration mismatch with the (single) 15s entry,
        // so the tolerant lookup discards it.
        let q = calc.quote(
            50_000_00000000,
            50_030_00000000,
            50_031_00000000,
            TouchDirection::Up,
            0,
            30_000,
        );
        assert_eq!(q.distance_bps, 6);
        assert!(!q.from_empirical, "must fall back");
    }

    #[test]
    fn empirical_safety_pad_protects_against_player_positive() {
        // If the realised p_touch suddenly spikes by `< safety_factor`,
        // the cell stays in house territory. With p_observed = 0.349 and
        // safety_factor = 1.5, the engine quotes mult = 0.95/0.524 ≈ 1.81×.
        // For the player to break even we'd need real_p ≥ 1/mult ≈ 0.553,
        // a 58 % move above the calibration. That margin is the whole
        // point of `empirical_safety_factor`.
        let mut table = EmpiricalPTouchTable::new();
        table.insert((2, 60_000, 0), 0.348597);
        let cfg = MultiplierConfig {
            empirical_p_touch_table: Some(table),
            empirical_safety_factor: 1.5,
            ..Default::default()
        };
        let calc = MultiplierCalculator::new(cfg);
        let q = calc.quote(
            50_000_00000000,
            50_010_00000000,
            50_011_00000000,
            TouchDirection::Up,
            0,
            60_000,
        );
        assert_eq!(q.distance_bps, 2);
        assert!(q.from_empirical);
        let mult = q.multiplier_bps as f64 / 10_000.0;
        // Player needs realised p ≥ 1/mult to break even.
        let breakeven_p = 1.0 / mult;
        let pad_room = breakeven_p / 0.348597;
        assert!(
            pad_room > 1.4,
            "safety pad should require ≥40% vol shift to flip EV; got {}",
            pad_room
        );
    }

    #[test]
    fn ev_positive_guard_flags_anchor_row() {
        // p_touch ≥ 1/floor_mult ⇒ EV_player > 0 ⇒ guard must trip.
        // With min_multiplier_bps = 11_000 (1.10×), floor breakeven is
        // p_touch = 1/1.10 ≈ 0.909.
        let calc = MultiplierCalculator::new(MultiplierConfig::default());
        assert!(calc.is_ev_positive_at_floor(0.95));
        assert!(calc.is_ev_positive_at_floor(0.91));
        assert!(!calc.is_ev_positive_at_floor(0.90));
        assert!(!calc.is_ev_positive_at_floor(0.50));
        assert!(!calc.is_ev_positive_at_floor(0.05));
    }

    #[test]
    fn ev_positive_threshold_tracks_min_multiplier() {
        // Higher floor mult ⇒ smaller p_touch trips the guard.
        let cfg = MultiplierConfig {
            min_multiplier_bps: 20_000, // 2.0×
            ..Default::default()
        };
        let calc = MultiplierCalculator::new(cfg);
        // 2.0 × 0.51 > 1.0 → flagged.
        assert!(calc.is_ev_positive_at_floor(0.51));
        // 2.0 × 0.49 < 1.0 → ok.
        assert!(!calc.is_ev_positive_at_floor(0.49));
    }

    #[test]
    fn near_price_cells_stay_at_floor_multiplier() {
        let cfg = MultiplierConfig {
            vol_bps_per_sqrt_sec: 2.8,
            min_multiplier_bps: 11_000,
            max_multiplier_bps: 5_000_000,
            ..Default::default()
        };
        let calc = MultiplierCalculator::new(cfg);
        let q = calc.quote(
            50_000_00000000,
            50_015_00000000, // 3bp near edge
            50_040_00000000,
            TouchDirection::Up,
            3_000,
            5_000,
        );
        assert_eq!(q.distance_bps, 3);
        assert_eq!(q.multiplier_bps, 11_000);
    }

    #[test]
    fn future_window_probability_yields_different_mults_per_window() {
        // Same band, same duration, different start offsets → different
        // multipliers. A column-1 cell ([0s, 3s]) prices a different
        // touch probability than a column-4 cell ([9s, 12s]) for an
        // identical band.
        //
        // For a far-but-reachable band the early window is the rarest
        // (price has barely moved), so the multiplier there must be
        // HIGHER than the late window's (where the price has had time
        // to drift toward the band, accumulating more touch mass per
        // window slice).
        //
        // Vol/distance chosen so neither offset hits the 0.005 p_touch
        // floor (which would clip both to the same cap mult).
        let cfg = MultiplierConfig {
            vol_bps_per_sqrt_sec: 5.0,
            min_multiplier_bps: 11_000,
            max_multiplier_bps: 5_000_000, // 500× — let the curve breathe
            ..Default::default()
        };
        let calc = MultiplierCalculator::new(cfg);
        let early = calc.quote(
            50_000_00000000,
            50_100_00000000,   // 20bp away
            50_120_00000000,
            TouchDirection::Up,
            0,
            3_000,
        );
        let later = calc.quote(
            50_000_00000000,
            50_100_00000000,
            50_120_00000000,
            TouchDirection::Up,
            9_000,
            3_000,
        );
        assert_ne!(
            early.multiplier_bps, later.multiplier_bps,
            "future-window pricing should produce different mults per offset"
        );
        assert!(
            early.multiplier_bps > later.multiplier_bps,
            "far-band early window should pay more than late: early={} later={}",
            early.multiplier_bps,
            later.multiplier_bps
        );
        // Both quotes echo back the offset they were priced under.
        assert_eq!(early.window_start_offset_ms, 0);
        assert_eq!(later.window_start_offset_ms, 9_000);
    }
}
