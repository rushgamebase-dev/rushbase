use crate::api::anti_replay::{idempotency_key, NonceError};
use crate::api::dto::{
    BetHistoryQuery, BetListResponse, BetResponse, EmpiricalCellDto, MultiplierConfigResponse,
    OpenBetRequest, PublicBetEntry, PublicBetListResponse, QuoteGridCellResponse, QuoteGridRequest,
    QuoteGridResponse, QuoteMatrixRequest, QuoteMatrixResponse, QuoteMatrixStartingIndex,
    QuoteRequest, QuoteResponse,
};
use crate::api::middleware::AuthenticatedUser;
use crate::api::state::AppState;
use crate::audit::{event, record_async, Severity};
use crate::errors::{ApiError, TradingError};
use crate::models::touch_bet::TouchDirection;
use crate::touch::engine::u256_to_u128_saturating;
use crate::touch::{quote_token_expect_match, OpenBet, QuoteTokenError};
use crate::ws::messages::{BetData, ServerMessage};
use actix_web::{web, HttpRequest, HttpResponse};
use alloy::primitives::U256;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::str::FromStr;
use uuid::Uuid;

/// Maximum length we accept in the `Idempotency-Key` header. Anything
/// longer is almost certainly malicious or buggy — Stripe/Square cap at 255.
const IDEMPOTENCY_KEY_MAX_LEN: usize = 255;

fn parse_direction(s: &str) -> Result<TouchDirection, ApiError> {
    match s.to_uppercase().as_str() {
        "UP" => Ok(TouchDirection::Up),
        "DOWN" => Ok(TouchDirection::Down),
        _ => Err(ApiError::validation_error("direction must be UP or DOWN")),
    }
}

fn parse_u256(name: &str, s: &str) -> Result<U256, ApiError> {
    U256::from_str(s).map_err(|_| {
        ApiError::validation_error(format!("{} must be a uint256 decimal string", name))
    })
}

/// Quote a touch bet: returns the multiplier the engine would honour
/// right now plus a signed token committing to it for ~2 s.
#[utoipa::path(
    post,
    path = "/api/v1/trade/quote",
    request_body = QuoteRequest,
    responses(
        (status = 200, description = "Quote with signed token", body = QuoteResponse),
        (status = 400, description = "Invalid input"),
        (status = 503, description = "Price feed unavailable"),
    ),
    tag = "trade",
)]
pub async fn quote(
    app_state: web::Data<AppState>,
    body: web::Json<QuoteRequest>,
) -> Result<HttpResponse, ApiError> {
    let direction = parse_direction(&body.direction)?;
    let target_min = parse_u256("target_row_min_q8", &body.target_row_min_q8)?;
    let target_max = parse_u256("target_row_max_q8", &body.target_row_max_q8)?;
    if target_max <= target_min {
        return Err(ApiError::validation_error(
            "target_row_max must be > target_row_min",
        ));
    }
    let symbol = app_state
        .touch_engine
        .canonical_symbol(&body.symbol)
        .ok_or_else(|| ApiError::bad_request("Unsupported Tap Trading symbol"))?;
    let q = app_state
        .touch_engine
        .quote(
            &symbol,
            direction,
            target_min,
            target_max,
            body.window_start_offset_ms,
            body.window_duration_ms,
        )
        .map_err(map_err)?;
    let entry = app_state
        .touch_engine
        .current_entry_q8(&symbol)
        .map_err(map_err)?;
    let entry_u = U256::from(entry as u64);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let quote_id = Uuid::new_v4();
    let quote_token = app_state.quote_signer.issue(
        quote_id,
        &symbol,
        direction,
        entry_u,
        target_min,
        target_max,
        body.window_start_offset_ms,
        body.window_duration_ms,
        q.multiplier_bps,
        now_ms,
    );
    let quote_expires_at_ms = now_ms + app_state.quote_signer.ttl_ms();
    Ok(HttpResponse::Ok().json(QuoteResponse {
        symbol,
        direction: direction.as_str().to_string(),
        entry_price_q8: entry.to_string(),
        target_row_min_q8: target_min.to_string(),
        target_row_max_q8: target_max.to_string(),
        window_duration_ms: body.window_duration_ms,
        window_start_offset_ms: body.window_start_offset_ms,
        distance_bps: q.distance_bps,
        implied_p_touch_bps: q.implied_p_touch_bps,
        multiplier_bps: q.multiplier_bps,
        server_time_ms: now_ms,
        from_empirical: q.from_empirical,
        quote_token,
        quote_expires_at_ms,
    }))
}

/// Price an entire grid of cells in one request — the frontend uses
/// this to render live multipliers across the visible catalog without
/// hitting the backend per cell. No HMAC token is issued; opening a bet
/// still requires a fresh `/trade/quote` call for the chosen cell.
///
/// For each input cell the engine returns:
/// - `multiplier_bps` — what the engine WOULD quote right now;
/// - `implied_p_touch_bps` — for transparency;
/// - `max_stake_wei` — largest stake that fits inside `max_payout_per_bet_wei`;
/// - `disabled_reason` — set when the cell can't be opened (EV+ trap,
///   distance out of range, stale feed, …).
#[utoipa::path(
    post,
    path = "/api/v1/trade/quote-grid",
    request_body = QuoteGridRequest,
    responses(
        (status = 200, description = "Per-cell quotes for the requested grid", body = QuoteGridResponse),
        (status = 400, description = "Invalid input"),
        (status = 503, description = "Price feed unavailable"),
    ),
    tag = "trade",
)]
pub async fn quote_grid(
    app_state: web::Data<AppState>,
    body: web::Json<QuoteGridRequest>,
) -> Result<HttpResponse, ApiError> {
    let symbol = app_state
        .touch_engine
        .canonical_symbol(&body.symbol)
        .ok_or_else(|| ApiError::bad_request("Unsupported Tap Trading symbol"))?;
    let entry = app_state
        .touch_engine
        .current_entry_q8(&symbol)
        .map_err(map_err)?;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let stale = app_state
        .real_price_feed
        .snapshot(&symbol)
        .map_or(false, |snapshot| snapshot.stale);
    let real_price_symbol = app_state.touch_engine.is_real_price_symbol(&symbol);

    let calc = app_state.touch_engine.multiplier();
    let cfg = calc.config();
    let min_distance = app_state.touch_engine.min_distance_bps();
    let max_distance = app_state.touch_engine.max_distance_bps();
    let max_payout = app_state.touch_engine.max_payout_per_bet_wei();
    let allowed_windows = app_state.touch_engine.allowed_window_ms_sorted();
    let accepting_bets = app_state.touch_engine.accepting_bets();

    let mut cells_out: Vec<QuoteGridCellResponse> = Vec::with_capacity(body.cells.len());
    for cell in &body.cells {
        // Parse direction + bands. A malformed cell yields a disabled
        // entry rather than a 400 — the rest of the grid still prices.
        let (dir, parse_err) = match parse_direction(&cell.direction) {
            Ok(d) => (Some(d), None),
            Err(_) => (None, Some("INVALID_BAND".to_string())),
        };
        let target_min = U256::from_str(&cell.target_row_min_q8).ok();
        let target_max = U256::from_str(&cell.target_row_max_q8).ok();
        if dir.is_none() || target_min.is_none() || target_max.is_none() {
            cells_out.push(QuoteGridCellResponse {
                cell_id: cell.cell_id.clone(),
                distance_bps: 0,
                implied_p_touch_bps: 0,
                multiplier_bps: 0,
                max_stake_wei: "0".to_string(),
                disabled_reason: parse_err.or(Some("INVALID_BAND".to_string())),
                from_empirical: false,
            });
            continue;
        }
        let dir = dir.unwrap();
        let target_min = target_min.unwrap();
        let target_max = target_max.unwrap();
        if target_max <= target_min {
            cells_out.push(QuoteGridCellResponse {
                cell_id: cell.cell_id.clone(),
                distance_bps: 0,
                implied_p_touch_bps: 0,
                multiplier_bps: 0,
                max_stake_wei: "0".to_string(),
                disabled_reason: Some("INVALID_BAND".to_string()),
                from_empirical: false,
            });
            continue;
        }

        let q = calc.quote(
            entry as u128,
            u256_to_u128_saturating(target_min),
            u256_to_u128_saturating(target_max),
            dir,
            cell.window_start_offset_ms,
            cell.window_duration_ms,
        );
        let p_touch = q.implied_p_touch_bps as f64 / 10_000.0;

        // Determine disabled_reason — order matters: feed-level issues
        // first, then geometry, then EV.
        let disabled_reason = if !accepting_bets {
            Some("PAUSED".to_string())
        } else if stale {
            Some("PRICE_STALE".to_string())
        } else if !allowed_windows.contains(&cell.window_duration_ms) {
            Some("INVALID_WINDOW".to_string())
        } else if q.distance_bps == 0 {
            // Band already envelops the live price — first-passage is
            // certain at offset=0 and reported p_touch underestimates
            // realised p elsewhere. Always disabled.
            Some("EV_POSITIVE".to_string())
        } else if q.distance_bps < min_distance {
            Some("TOO_EASY".to_string())
        } else if q.distance_bps > max_distance {
            Some("TOO_RISKY".to_string())
        } else if !real_price_symbol && !q.from_empirical {
            // No calibrated entry for this `(distance, duration,
            // offset)` triple. Bachelier fallback systematically
            // under-prices wide bands against the VRF generator —
            // see `tests/economic_safety.rs` for the documented
            // exploit. Refuse the cell entirely until the table
            // covers it. The UX should grey out cells with this
            // reason and not allow a click.
            //
            // TODO(P1): extend `calibrate_vrf` to sweep
            // `window_start_offset_ms ∈ {0, 3000, 6000, 9000}` and
            // index `EmpiricalCell` by offset so future-column
            // cells become quotable.
            Some("UNCALIBRATED".to_string())
        } else if calc.is_ev_positive_at_floor(p_touch) {
            Some("EV_POSITIVE".to_string())
        } else {
            // Direction-band geometric check is gone with the legacy
            // bullish/bearish model — the resolver only cares about
            // first-touch of the band during the window. EV_POSITIVE
            // above already covers the only invalid geometry (snake
            // already inside the band ⇒ p_touch * mult_floor > 1).
            None
        };

        // max_stake_wei such that stake * multiplier_bps / 10_000 ≤ max_payout.
        let max_stake = if q.multiplier_bps == 0 {
            U256::ZERO
        } else {
            (max_payout.saturating_mul(U256::from(10_000u64))) / U256::from(q.multiplier_bps as u64)
        };

        cells_out.push(QuoteGridCellResponse {
            cell_id: cell.cell_id.clone(),
            distance_bps: q.distance_bps,
            implied_p_touch_bps: q.implied_p_touch_bps,
            multiplier_bps: q.multiplier_bps,
            max_stake_wei: max_stake.to_string(),
            disabled_reason,
            from_empirical: q.from_empirical,
        });
    }

    Ok(HttpResponse::Ok().json(QuoteGridResponse {
        symbol,
        server_time_ms: now_ms,
        entry_price_q8: entry.to_string(),
        house_edge_bps: cfg.house_edge_bps,
        max_payout_per_bet_wei: max_payout.to_string(),
        cells: cells_out,
    }))
}

/// Return an Euphoria-style rectangular matrix of multiplier quotes.
///
/// The matrix is row-major by time, then price:
/// `idx = (time_index - start_time_index) * price_steps + (price_index - start_price_index)`.
/// Values are Uint16 hundredths of multiplier, little-endian, base64 encoded.
#[utoipa::path(
    post,
    path = "/api/v1/trade/quote-matrix",
    request_body = QuoteMatrixRequest,
    responses(
        (status = 200, description = "Compact multiplier matrix", body = QuoteMatrixResponse),
        (status = 400, description = "Invalid input"),
        (status = 503, description = "Price feed unavailable"),
    ),
    tag = "trade",
)]
pub async fn quote_matrix(
    app_state: web::Data<AppState>,
    body: web::Json<QuoteMatrixRequest>,
) -> Result<HttpResponse, ApiError> {
    if body.time_interval_ms == 0 {
        return Err(ApiError::validation_error("time_interval_ms must be > 0"));
    }
    if body.time_steps == 0 || body.price_steps == 0 {
        return Err(ApiError::validation_error("matrix dimensions must be > 0"));
    }
    let total_cells = body.time_steps as usize * body.price_steps as usize;
    if total_cells > 10_000 {
        return Err(ApiError::validation_error("matrix is too large"));
    }

    let symbol = app_state
        .touch_engine
        .canonical_symbol(&body.symbol)
        .ok_or_else(|| ApiError::bad_request("Unsupported Tap Trading symbol"))?;
    let entry = app_state
        .touch_engine
        .current_entry_q8(&symbol)
        .map_err(map_err)?;
    let price_interval = parse_u256("price_interval_q8", &body.price_interval_q8)?;
    if price_interval == U256::ZERO {
        return Err(ApiError::validation_error("price_interval_q8 must be > 0"));
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let stale = app_state
        .real_price_feed
        .snapshot(&symbol)
        .map_or(false, |snapshot| snapshot.stale);
    let real_price_symbol = app_state.touch_engine.is_real_price_symbol(&symbol);
    let calc = app_state.touch_engine.multiplier();
    let cfg = calc.config();
    let min_distance = app_state.touch_engine.min_distance_bps();
    let max_distance = app_state.touch_engine.max_distance_bps();
    let max_payout = app_state.touch_engine.max_payout_per_bet_wei();
    let allowed_windows = app_state.touch_engine.allowed_window_ms_sorted();
    let accepting_bets = app_state.touch_engine.accepting_bets();
    let time_interval_i64 = i64::try_from(body.time_interval_ms)
        .map_err(|_| ApiError::validation_error("time_interval_ms is too large"))?;

    let mut bytes = Vec::with_capacity(total_cells * 2);
    for t in 0..body.time_steps {
        let time_index = body.start_time_index + i64::from(t);
        let window_start_ms = time_index.saturating_mul(time_interval_i64);
        let window_start_offset_ms = if window_start_ms > now_ms {
            (window_start_ms - now_ms) as u64
        } else {
            0
        };

        for p in 0..body.price_steps {
            let price_index = body.start_price_index + i64::from(p);
            let mut encoded: u16 = 0;

            if price_index >= 0 && allowed_windows.contains(&body.time_interval_ms) {
                let band_min = price_interval.saturating_mul(U256::from(price_index as u64));
                let band_max = band_min.saturating_add(price_interval);
                if band_max > band_min {
                    let direction = if u256_to_u128_saturating(band_min) >= entry.max(0) as u128 {
                        TouchDirection::Up
                    } else {
                        TouchDirection::Down
                    };
                    let q = calc.quote(
                        entry as u128,
                        u256_to_u128_saturating(band_min),
                        u256_to_u128_saturating(band_max),
                        direction,
                        window_start_offset_ms,
                        body.time_interval_ms,
                    );
                    let p_touch = q.implied_p_touch_bps as f64 / 10_000.0;
                    let disabled = !accepting_bets
                        || stale
                        || q.distance_bps == 0
                        || q.distance_bps < min_distance
                        || q.distance_bps > max_distance
                        || (!real_price_symbol && !q.from_empirical)
                        || calc.is_ev_positive_at_floor(p_touch);
                    if !disabled {
                        encoded = ((q.multiplier_bps + 50) / 100).min(u16::MAX as u32) as u16;
                    }
                }
            }

            bytes.extend_from_slice(&encoded.to_le_bytes());
        }
    }

    Ok(HttpResponse::Ok().json(QuoteMatrixResponse {
        symbol,
        server_time_ms: now_ms,
        entry_price_q8: entry.to_string(),
        starting_index: QuoteMatrixStartingIndex {
            time_index: body.start_time_index,
            price_index: body.start_price_index,
        },
        time_steps: body.time_steps,
        price_steps: body.price_steps,
        grid: BASE64_STANDARD.encode(bytes),
        house_edge_bps: cfg.house_edge_bps,
        max_payout_per_bet_wei: max_payout.to_string(),
        accepting_bets,
    }))
}

/// Snapshot of the multiplier-pricing config so the frontend can
/// replicate `multiplierFor` locally and show per-cell labels that
/// match what `/trade/quote` will return. Public, no auth required —
/// the table itself is treated as published market data.
#[utoipa::path(
    get,
    path = "/api/v1/trade/multiplier_config",
    responses(
        (status = 200, description = "Active multiplier-pricing parameters", body = MultiplierConfigResponse),
    ),
    tag = "trade",
)]
pub async fn multiplier_config(app_state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    let cfg = app_state.touch_engine.multiplier().config();
    let cells: Vec<EmpiricalCellDto> = cfg
        .empirical_p_touch_table
        .as_ref()
        .map(|table| {
            let mut v: Vec<EmpiricalCellDto> = table
                .iter()
                .map(|((d, dur, off), p)| EmpiricalCellDto {
                    distance_bps: *d,
                    duration_ms: *dur,
                    window_start_offset_ms: *off,
                    p_touch: *p,
                })
                .collect();
            // Sort so the response is deterministic — easier on cache
            // keys, snapshot tests, and humans reading the JSON.
            v.sort_by(|a, b| {
                a.distance_bps
                    .cmp(&b.distance_bps)
                    .then(a.window_start_offset_ms.cmp(&b.window_start_offset_ms))
                    .then(a.duration_ms.cmp(&b.duration_ms))
            });
            v
        })
        .unwrap_or_default();
    Ok(HttpResponse::Ok().json(MultiplierConfigResponse {
        house_edge_bps: cfg.house_edge_bps,
        min_multiplier_bps: cfg.min_multiplier_bps,
        max_multiplier_bps: cfg.max_multiplier_bps,
        vol_bps_per_sqrt_sec: cfg.vol_bps_per_sqrt_sec,
        empirical_safety_factor: cfg.empirical_safety_factor,
        empirical_cells: cells,
        min_distance_bps: app_state.touch_engine.min_distance_bps(),
        max_distance_bps: app_state.touch_engine.max_distance_bps(),
        allowed_window_ms: app_state.touch_engine.allowed_window_ms_sorted(),
    }))
}

/// Place a touch bet referencing a previous `quote_token`. Idempotent
/// when the client supplies an `Idempotency-Key` header.
#[utoipa::path(
    post,
    path = "/api/v1/trade/bets",
    request_body = OpenBetRequest,
    responses(
        (status = 201, description = "Bet placed", body = BetResponse),
        (status = 400, description = "Invalid token, expired quote, or balance/exposure rejection"),
        (status = 401, description = "Authentication required"),
        (status = 503, description = "Engine in safe mode (breaker tripped)"),
    ),
    security(("bearer_auth" = [])),
    tag = "trade",
)]
pub async fn open_bet(
    req: HttpRequest,
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    body: web::Json<OpenBetRequest>,
) -> Result<HttpResponse, ApiError> {
    let direction = parse_direction(&body.direction)?;
    let stake = parse_u256("stake_wei", &body.stake_wei)?;
    let target_min = parse_u256("target_row_min_q8", &body.target_row_min_q8)?;
    let target_max = parse_u256("target_row_max_q8", &body.target_row_max_q8)?;
    let symbol = app_state
        .touch_engine
        .canonical_symbol(&body.symbol)
        .ok_or_else(|| ApiError::bad_request("Unsupported Tap Trading symbol"))?;
    if !app_state.touch_engine.accepting_bets() {
        return Err(ApiError::service_unavailable("Tap Trading is paused"));
    }
    let window_duration_ms = (body.window_end_ms - body.window_start_ms).max(0) as u64;

    // Idempotency: if the client supplied a key and we've already seen
    // it, replay the cached response verbatim — no engine call, no
    // double-bet. The cache key is `(user, key)` so keys are scoped per
    // wallet (a leaked key from one user can't conflict with another).
    let idempotency_key_header = req
        .headers()
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.len() <= IDEMPOTENCY_KEY_MAX_LEN)
        .map(|s| s.to_string());

    if let Some(ref key) = idempotency_key_header {
        let cache_key = idempotency_key(user.user_id, key);
        if let Some(cached) = app_state.idempotency.get(&cache_key).await {
            return Ok(actix_web::HttpResponse::build(
                actix_web::http::StatusCode::from_u16(cached.status)
                    .unwrap_or(actix_web::http::StatusCode::CREATED),
            )
            .insert_header(("Idempotent-Replayed", "true"))
            .insert_header(("Content-Type", "application/json"))
            .body(cached.body));
        }
    }

    // Validate the signed quote token. This is the gate that closes the
    // quote-shopping path: every bet must reference a token issued ≤ TTL
    // ago, with parameters identical to the bet body and the multiplier
    // the engine recorded at quote time.
    let now_ms = chrono::Utc::now().timestamp_millis();
    let payload = app_state
        .quote_signer
        .verify(&body.quote_token, now_ms)
        .map_err(quote_err_to_api)?;
    // Reconstruct the offset the client priced under: the time gap
    // between the bet's window-start and the moment the quote was issued.
    // We compare against the offset baked into the signed token (with a
    // small tolerance for click latency).
    let bet_window_start_offset_ms = (body.window_start_ms - payload.issued_at_ms).max(0) as u64;
    quote_token_expect_match(
        &payload,
        &symbol,
        direction,
        target_min,
        target_max,
        window_duration_ms,
        bet_window_start_offset_ms,
        body.expected_multiplier_bps,
    )
    .map_err(quote_err_to_api)?;

    // Burn the quote nonce — single-use, even within its TTL. Without
    // this a client could lock in a favourable multiplier and amortise
    // it over many cheap stakes during the 2 s window.
    app_state
        .quote_nonces
        .consume(payload.quote_id)
        .await
        .map_err(nonce_err_to_api)?;

    let bet = app_state
        .touch_engine
        .open_bet(OpenBet {
            user_id: user.user_id,
            symbol,
            direction,
            stake_wei: stake,
            target_row_min_q8: target_min,
            target_row_max_q8: target_max,
            window_start_ms: body.window_start_ms,
            window_end_ms: body.window_end_ms,
            expected_multiplier_bps: body.expected_multiplier_bps,
        })
        .await
        .map_err(map_err)?;

    // Push to the user's `bets:{user_id}` channel for real-time updates.
    app_state.broadcaster.broadcast_to_channel(
        &format!("bets:{}", user.user_id),
        ServerMessage::BetPlaced {
            bet: BetData::from(&bet),
        },
    );

    app_state
        .metrics
        .bets_placed_total
        .with_label_values(&[bet.symbol.as_str(), direction.as_str()])
        .inc();

    record_async(
        app_state.pool.clone(),
        Some(user.user_id),
        event::TOUCH_BET_OPENED,
        Severity::Info,
        Some(serde_json::json!({
            "bet_id": bet.id,
            "symbol": bet.symbol,
            "direction": direction.as_str(),
            "stake_wei": stake.to_string(),
            "multiplier_bps": bet.multiplier_bps,
            "window_ms": bet.window_end_ms - bet.window_start_ms,
        })),
    );

    let bet_response = BetResponse::from(&bet);
    let body_bytes = serde_json::to_vec(&bet_response).unwrap_or_default();

    if let Some(ref key) = idempotency_key_header {
        let cache_key = idempotency_key(user.user_id, key);
        app_state
            .idempotency
            .put(cache_key, 201, body_bytes.clone())
            .await;
    }

    Ok(HttpResponse::Created()
        .insert_header(("Content-Type", "application/json"))
        .body(body_bytes))
}

/// List the authenticated user's currently-active bets (status = ACTIVE).
#[utoipa::path(
    get,
    path = "/api/v1/trade/bets",
    responses((status = 200, description = "Active bets", body = BetListResponse)),
    security(("bearer_auth" = [])),
    tag = "trade",
)]
pub async fn list_active(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let bets = app_state
        .touch_engine
        .bet_repo()
        .get_user_active(user.user_id)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?;
    Ok(HttpResponse::Ok().json(BetListResponse {
        total: bets.len() as i64,
        bets: bets.iter().map(BetResponse::from).collect(),
    }))
}

pub async fn get_bet(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    let b = app_state
        .touch_engine
        .bet_repo()
        .find_by_id(id)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?
        .ok_or_else(|| ApiError::not_found("Bet not found"))?;
    if b.user_id != user.user_id {
        return Err(ApiError::forbidden("You don't own this bet"));
    }
    Ok(HttpResponse::Ok().json(BetResponse::from(&b)))
}

/// Provably-fair verification bundle for a settled bet.
///
/// Returns `425 Too Early` while the bet's window is still open —
/// the seed must not leak before resolution. Once `now >=
/// window_end_ms`, returns the revealed seed + path hash + commit
/// signature so the client can replay the path locally and confirm
/// the engine didn't lie about the outcome.
#[utoipa::path(
    get,
    path = "/api/v1/trade/bets/{id}/verify",
    responses(
        (status = 200, description = "Verification bundle", body = crate::api::dto::BetVerificationResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Not the bet owner"),
        (status = 404, description = "Bet not found"),
        (status = 425, description = "Window has not elapsed yet"),
    ),
    security(("bearer_auth" = [])),
    tag = "trade",
)]
pub async fn verify_bet(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let id = path.into_inner();
    let bet = app_state
        .touch_engine
        .bet_repo()
        .find_by_id(id)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?
        .ok_or_else(|| ApiError::not_found("Bet not found"))?;

    if bet.user_id != user.user_id {
        return Err(ApiError::forbidden("You don't own this bet"));
    }

    // Hard gate: refuse to reveal anything until the window has
    // elapsed. Even a tampered DB row that prematurely populated
    // `revealed_seed` would be filtered here. The status check is
    // belt-and-braces (an ACTIVE bet with a populated reveal would
    // be a data-integrity bug; we don't reward it with a payload).
    let now_ms = chrono::Utc::now().timestamp_millis();
    if now_ms < bet.window_end_ms || bet.status == crate::models::touch_bet::TouchStatus::Active {
        return Ok(
            HttpResponse::build(actix_web::http::StatusCode::from_u16(425).unwrap()).json(
                serde_json::json!({
                    "code": "WINDOW_NOT_ELAPSED",
                    "message": "Bet window is still open — verify after window_end_ms",
                    "window_end_ms": bet.window_end_ms,
                    "server_time_ms": now_ms,
                }),
            ),
        );
    }

    // Pull the reveal columns. If any is missing the resolver
    // wrote an inconsistent row — refuse to confuse the client with
    // a partial bundle.
    let (Some(seed_bytes), Some(path_hash), Some(cfg_ver), Some(commit_hash), Some(sig)) = (
        bet.revealed_seed.as_ref(),
        bet.path_points_hash.as_ref(),
        bet.path_config_version.as_ref(),
        bet.commit_hash.as_ref(),
        bet.commit_signature.as_ref(),
    ) else {
        return Err(ApiError::internal(
            "Bet is past its window but missing reveal columns. Contact support.",
        ));
    };

    // The user_wallet is part of the commit preimage — surface it so
    // the client doesn't have to look up its own /user/profile to
    // verify, and so the verification is also straightforward for an
    // observer who knows the bet id but not the wallet (auditors).
    let wallet: String = sqlx::query_scalar("SELECT wallet_address FROM users WHERE id = $1")
        .bind(bet.user_id)
        .fetch_one(&app_state.pool)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?;

    let response = crate::api::dto::BetVerificationResponse {
        bet_id: bet.id,
        status: bet.status.as_str().to_string(),
        user_wallet: wallet,
        commit_hash: hex::encode(commit_hash),
        commit_signature: hex::encode(sig),
        commit_signer_address: format!("0x{:x}", app_state.commit_signer.signer_address()),
        path_config_version: cfg_ver.clone(),
        path_regime: bet.path_regime.clone(),
        revealed_seed_hex: hex::encode(seed_bytes),
        path_points_hash: path_hash.clone(),
        target_row_min_q8: bet.target_row_min_q8.to_string(),
        target_row_max_q8: bet.target_row_max_q8.to_string(),
        window_start_ms: bet.window_start_ms,
        window_end_ms: bet.window_end_ms,
        entry_price_q8: bet.entry_price_q8.to_string(),
        touched_at: bet.touched_at.map(|t| t.timestamp_millis()),
        resolved_at: bet.resolved_at.map(|t| t.timestamp_millis()),
    };
    Ok(HttpResponse::Ok().json(response))
}

/// Paginated history of resolved (WON / LOST / CANCELLED) bets.
#[utoipa::path(
    get,
    path = "/api/v1/trade/history",
    params(BetHistoryQuery),
    responses((status = 200, description = "Resolved bets", body = BetListResponse)),
    security(("bearer_auth" = [])),
    tag = "trade",
)]
pub async fn list_history(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    query: web::Query<BetHistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let bets = app_state
        .touch_engine
        .bet_repo()
        .get_user_history(user.user_id, limit, offset)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?;
    Ok(HttpResponse::Ok().json(BetListResponse {
        total: bets.len() as i64,
        bets: bets.iter().map(BetResponse::from).collect(),
    }))
}

/// `GET /api/v1/trade/bets/public` — anonymised list of currently
/// active bets across all users. Drives the "Active Bets" social-proof
/// panel in the canvas. No auth required: only public bet data
/// (anonymised handle) is exposed; user IDs / tokens / commit material
/// stay private.
#[utoipa::path(
    get,
    path = "/api/v1/trade/bets/public",
    responses((status = 200, description = "Active bets, anonymised",
                body = PublicBetListResponse)),
    tag = "trade",
)]
pub async fn list_public_active(app_state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    // 50 rows is plenty for a canvas-side scrolling panel; bumping
    // would mostly inflate response size without UX gain.
    let rows = app_state
        .touch_engine
        .bet_repo()
        .list_public_active(50)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?;
    Ok(HttpResponse::Ok().json(PublicBetListResponse {
        total: rows.len() as i64,
        bets: rows.iter().map(PublicBetEntry::from).collect(),
    }))
}

/// `GET /api/v1/trade/heatmap` — aggregated ACTIVE bets per cell +
/// "online" headcount. Single round-trip; the canvas uses the cell
/// rows to render a glow heatmap and the count for the room pill.
#[utoipa::path(
    get,
    path = "/api/v1/trade/heatmap",
    responses((status = 200, description = "Active-bet heatmap + online count",
                body = crate::api::dto::touch::HeatmapResponse)),
    tag = "trade",
)]
pub async fn get_heatmap(app_state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    let (online_count, cells) = app_state
        .touch_engine
        .bet_repo()
        .list_active_heatmap()
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?;
    Ok(
        HttpResponse::Ok().json(crate::api::dto::touch::HeatmapResponse {
            online_count,
            cells: cells
                .iter()
                .map(crate::api::dto::touch::HeatmapCell::from)
                .collect(),
        }),
    )
}

/// `GET /api/v1/trade/wins/public` — anonymised list of recent WON
/// bets. Drives the "Recent Wins" panel. Same privacy stance as
/// `/trade/bets/public`.
#[utoipa::path(
    get,
    path = "/api/v1/trade/wins/public",
    responses((status = 200, description = "Recent wins, anonymised",
                body = PublicBetListResponse)),
    tag = "trade",
)]
pub async fn list_public_wins(app_state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    let rows = app_state
        .touch_engine
        .bet_repo()
        .list_public_recent_wins(20)
        .await
        .map_err(|e| ApiError::internal(format!("DB: {}", e)))?;
    Ok(HttpResponse::Ok().json(PublicBetListResponse {
        total: rows.len() as i64,
        bets: rows.iter().map(PublicBetEntry::from).collect(),
    }))
}

fn nonce_err_to_api(e: NonceError) -> ApiError {
    match e {
        NonceError::AlreadyUsed => {
            ApiError::bad_request("Quote already consumed — please re-quote")
        }
    }
}

fn quote_err_to_api(e: QuoteTokenError) -> ApiError {
    use QuoteTokenError::*;
    match e {
        Expired => ApiError::bad_request("Quote expired — please re-quote"),
        BadSignature | BadFormat | BadEncoding | BadPayload => {
            ApiError::bad_request("Quote token invalid")
        }
        Mismatch { field } => ApiError::bad_request(format!(
            "Quote token does not match request: {} drift",
            field
        )),
        BadKey => ApiError::internal("Engine quote signing key misconfigured"),
    }
}

fn map_err(e: TradingError) -> ApiError {
    use TradingError::*;
    match e {
        InsufficientBalance {
            required_wei,
            available_wei,
        } => ApiError::bad_request(format!(
            "Insufficient balance: required {} wei, available {} wei",
            required_wei, available_wei
        )),
        BetAlreadyResolved => ApiError::conflict("Bet already resolved"),
        BetNotFound(_) => ApiError::not_found("Bet not found"),
        BetNotOwned => ApiError::forbidden("You don't own this bet"),
        MaxActiveBetsReached { current, max } => {
            ApiError::bad_request(format!("Maximum active bets: {} of {}", current, max))
        }
        CircuitBreakerOpen => ApiError::service_unavailable("Trading temporarily suspended"),
        SafeMode => ApiError::service_unavailable("Engine in safe mode"),
        PriceUnavailable(s) => {
            ApiError::service_unavailable(format!("Price unavailable for {}", s))
        }
        StalePrice { symbol, age_ms } => {
            ApiError::service_unavailable(format!("Price for {} stale ({}ms)", symbol, age_ms))
        }
        QuoteMismatch {
            expected_multiplier_bps,
            actual_multiplier_bps,
        } => ApiError::bad_request(format!(
            "Quote mismatch: client expected {}, server quotes {}. Re-quote required.",
            expected_multiplier_bps, actual_multiplier_bps
        )),
        InvalidSymbol(_)
        | InvalidStakeAmount { .. }
        | InvalidWindow { .. }
        | InvalidBand { .. } => ApiError::validation_error(e.to_string()),
        HouseSolvencyViolated { .. }
        | HouseBufferTooLow { .. }
        | PerSymbolExposureLimitExceeded { .. }
        | PayoutCapExceeded { .. } => ApiError::bad_request(e.to_string()),
        _ => ApiError::internal(format!("{}", e)),
    }
}
