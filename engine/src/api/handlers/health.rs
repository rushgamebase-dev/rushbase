use crate::api::state::AppState;
use actix_web::{web, HttpResponse};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

#[derive(Serialize)]
pub struct ReadinessResponse {
    /// `"ready"`, `"degraded"`, or `"not_ready"`. Orchestrators should
    /// keep routing traffic for the first two — they signal a healthy
    /// process that can still serve, just with a caveat (e.g. feed is
    /// slow but not stale enough to trip the breaker).
    pub status: &'static str,
    pub version: &'static str,
    /// Set when `status == "degraded"`. Empty otherwise.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub degraded_reasons: Vec<String>,
    pub database: SubsystemStatus,
    pub price_feed: PriceFeedStatus,
    pub circuit_breaker: BreakerStatus,
    pub exposure: ExposureStatus,
}

#[derive(Serialize)]
pub struct SubsystemStatus {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct PriceFeedStatus {
    pub ok: bool,
    pub max_age_ms: i64,
    pub symbols: Vec<SymbolFeed>,
}

#[derive(Serialize)]
pub struct SymbolFeed {
    pub symbol: String,
    pub last_bucket_age_ms: i64,
}

#[derive(Serialize)]
pub struct BreakerStatus {
    pub tripped: bool,
}

#[derive(Serialize)]
pub struct ExposureStatus {
    pub total_potential_payout_wei: String,
}

/// Cheap liveness — only confirms the process is running.
pub async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Readiness — three-tier:
///
///   - `ready`:     all subsystems healthy. 200.
///   - `degraded`:  process can still serve but something is slow or
///                  partially impaired (e.g. feed lag 10–30 s, breaker
///                  not tripped). 200 — orchestrator keeps traffic.
///   - `not_ready`: hard fail (DB unreachable or breaker tripped).
///                  503 — orchestrator drains pod.
///
/// `degraded_reasons` makes the soft-fail visible to humans without
/// breaking automated probes that only key on the HTTP status.
pub async fn readiness_check(app_state: web::Data<AppState>) -> HttpResponse {
    // Soft-degrade once feed lag crosses this threshold; we still trip
    // the breaker (and 503) at the engine's `stale_threshold_ms` (30 s).
    const FEED_DEGRADED_MS: i64 = 10_000;

    let db_ok = sqlx::query("SELECT 1")
        .fetch_one(&app_state.pool)
        .await
        .is_ok();

    let now_ms = chrono::Utc::now().timestamp_millis();
    // The Rush Index is in-process and always fresh while the
    // advancer task is alive. We use a generous "stale" threshold
    // (advancer expected to tick every 150 ms; 5 s of silence
    // means the task is gone). `max_age_ms` here is the hard-fail
    // threshold; `FEED_DEGRADED_MS` is the soft-warn one.
    let max_age_ms: i64 = 5_000;

    let arena_age = (now_ms - app_state.arena_index.last_update_ms()).max(0);
    let feed_hard_fail = arena_age > max_age_ms;
    let feed_degraded = arena_age > FEED_DEGRADED_MS && !feed_hard_fail;
    let symbols = vec![SymbolFeed {
        symbol: crate::arena_index::RUSH_INDEX_SYMBOL.to_string(),
        last_bucket_age_ms: arena_age,
    }];

    let breaker_tripped = app_state.exposure.is_circuit_breaker_triggered();
    let total_payout = app_state.exposure.total_potential_payout_wei();

    let hard_fail = !db_ok || feed_hard_fail || breaker_tripped;
    let mut degraded_reasons = Vec::new();
    if !hard_fail {
        if feed_degraded {
            degraded_reasons.push("price_feed_slow".into());
        }
    }

    let status: &'static str = if hard_fail {
        "not_ready"
    } else if !degraded_reasons.is_empty() {
        "degraded"
    } else {
        "ready"
    };

    let body = ReadinessResponse {
        status,
        version: env!("CARGO_PKG_VERSION"),
        degraded_reasons,
        database: SubsystemStatus {
            ok: db_ok,
            error: if db_ok { None } else { Some("query SELECT 1 failed".into()) },
        },
        price_feed: PriceFeedStatus {
            ok: !feed_hard_fail,
            max_age_ms,
            symbols,
        },
        circuit_breaker: BreakerStatus {
            tripped: breaker_tripped,
        },
        exposure: ExposureStatus {
            total_potential_payout_wei: total_payout.to_string(),
        },
    };

    if hard_fail {
        HttpResponse::ServiceUnavailable().json(body)
    } else {
        HttpResponse::Ok().json(body)
    }
}
