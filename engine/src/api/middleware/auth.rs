use actix_web::{dev::ServiceRequest, web, Error, HttpMessage};
use actix_web_httpauth::extractors::bearer::BearerAuth;
use uuid::Uuid;

use crate::api::state::AppState;

/// Authenticated user extracted from a JWT bearer token.
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub user_id: Uuid,
    /// 0x-lowercase wallet address.
    pub wallet: String,
}

impl actix_web::FromRequest for AuthenticatedUser {
    type Error = actix_web::Error;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self, Self::Error>>>,
    >;

    fn from_request(
        req: &actix_web::HttpRequest,
        _payload: &mut actix_web::dev::Payload,
    ) -> Self::Future {
        let req = req.clone();
        Box::pin(async move {
            req.extensions()
                .get::<AuthenticatedUser>()
                .cloned()
                .ok_or_else(|| {
                    actix_web::error::ErrorUnauthorized("Authentication required")
                })
        })
    }
}

/// Validator function for bearer-token authentication.
///
/// Five checks run in order, all must pass:
///  1. JWT signature + `exp` claim valid.
///  2. `users.is_active` is `true` — banned/disabled accounts can't
///     reuse a still-fresh token (cached, 30 s TTL, invalidated on ban).
///  3. Token's `iat` ≥ `users.tokens_invalidated_before_ms / 1000` —
///     blocks every token issued before a "revoke all" event for this
///     user (suspected device theft, JWT secret rotation).
///  4. Token's `jti` not in `jwt_revocations` — blocks single-session
///     logout, surgical admin revoke. PRIMARY KEY lookup, sub-ms.
///  5. Per-user sliding-window rate limit hasn't been exhausted.
pub async fn validator(
    req: ServiceRequest,
    credentials: BearerAuth,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let app_state = req
        .app_data::<web::Data<AppState>>()
        .expect("AppState not found");

    let claims = match app_state.jwt_service.validate_access_token(credentials.token()) {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(error = %e, "JWT validation failed");
            return Err((
                actix_web::error::ErrorUnauthorized("Invalid or expired token"),
                req,
            ));
        }
    };

    // is_active gate. The `UserActiveCache` (30 s TTL) absorbs the hot
    // path; cache miss falls through to a single-row PK lookup. Banning
    // takes effect on the next cache eviction (≤ 30 s), or instantly
    // via `cache.invalidate(user_id)` from an admin endpoint.
    use crate::api::anti_replay::ActiveLookup;
    let active = match app_state.user_active_cache.get(claims.sub).await {
        Some(v) => v,
        None => {
            let row: Option<bool> = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
                .bind(claims.sub)
                .fetch_optional(&app_state.pool)
                .await
                .unwrap_or(None);
            match row {
                Some(active) => {
                    app_state.user_active_cache.put(claims.sub, active).await;
                    if active {
                        ActiveLookup::Active
                    } else {
                        ActiveLookup::Inactive
                    }
                }
                None => ActiveLookup::Unknown,
            }
        }
    };
    match active {
        ActiveLookup::Active => {}
        ActiveLookup::Inactive => {
            return Err((
                actix_web::error::ErrorForbidden("User account is inactive"),
                req,
            ));
        }
        ActiveLookup::Unknown => {
            return Err((
                actix_web::error::ErrorUnauthorized("User not found"),
                req,
            ));
        }
    }

    // Per-user mass-invalidation watermark. A "revoke all tokens" admin
    // call (or a JWT-secret rotation event) bumps the user's column to
    // `now`; every token whose `iat` is older is rejected here without
    // needing to enumerate sessions.
    let invalidated_before_ms: Option<i64> = sqlx::query_scalar(
        "SELECT tokens_invalidated_before_ms FROM users WHERE id = $1",
    )
    .bind(claims.sub)
    .fetch_optional(&app_state.pool)
    .await
    .unwrap_or(None);
    if let Some(threshold) = invalidated_before_ms {
        if claims.iat * 1_000 < threshold {
            return Err((
                actix_web::error::ErrorUnauthorized(
                    "Token was issued before a forced re-auth; please log in again",
                ),
                req,
            ));
        }
    }

    // Per-token revocation list. Logout, admin surgical revoke, and
    // suspected-leak workflows insert here. The PRIMARY KEY makes the
    // lookup constant-time even at millions of revoked rows; the GC
    // sweep prunes entries past their JWT TTL.
    if claims.jti != uuid::Uuid::nil() {
        let revoked: Option<()> = sqlx::query_scalar(
            "SELECT 1::int FROM jwt_revocations WHERE jti = $1",
        )
        .bind(claims.jti)
        .fetch_optional(&app_state.pool)
        .await
        .ok()
        .flatten()
        .map(|_: i32| ());
        if revoked.is_some() {
            return Err((
                actix_web::error::ErrorUnauthorized("Token has been revoked"),
                req,
            ));
        }
    }

    // Per-user rate limit. Closes the proxy/CGNAT loophole left by the
    // per-IP governor on /auth and /quote: once authenticated, a user
    // can't out-rotate IPs.
    if let Err(e) = app_state.user_rate_limiter.check(claims.sub).await {
        tracing::warn!(user_id = %claims.sub, error = %e, "Per-user rate limit exceeded");
        return Err((
            actix_web::error::ErrorTooManyRequests("Rate limit exceeded"),
            req,
        ));
    }

    let authenticated_user = AuthenticatedUser {
        user_id: claims.sub,
        wallet: claims.wallet,
    };
    req.extensions_mut().insert(authenticated_user);
    Ok(req)
}

/// Optional authentication validator — allows unauthenticated requests
/// to pass through but populates `AuthenticatedUser` when a valid token
/// is present.
pub async fn optional_validator(
    req: ServiceRequest,
    credentials: Option<BearerAuth>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    if let Some(creds) = credentials {
        let app_state = req
            .app_data::<web::Data<AppState>>()
            .expect("AppState not found");

        if let Ok(claims) = app_state.jwt_service.validate_access_token(creds.token()) {
            let authenticated_user = AuthenticatedUser {
                user_id: claims.sub,
                wallet: claims.wallet,
            };
            req.extensions_mut().insert(authenticated_user);
        }
    }
    Ok(req)
}
